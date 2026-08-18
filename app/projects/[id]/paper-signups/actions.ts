"use server";

import { z } from "zod";

import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  activeOrganizationRole,
  canManageProjectAccess,
} from "@/lib/projects/management-access";
import { getAttendanceScheduleWindow } from "@/lib/attendance/challenge";
import { resolveScheduleId } from "@/utils/project";
import {
  getPublishStateKey,
  issueCertificatesForSignups,
} from "../hours/certificate-issuance";
import {
  PAPER_SCAN_MAX_IMAGES,
  PAPER_SCAN_MAX_IMAGE_BYTES,
  PAPER_SCAN_MAX_ROWS_PER_BATCH,
} from "@/lib/ai/paper-signup-schema";
import type { Project } from "@/types";

type PaperScanProject = Project & {
  organization_id: string | null;
  can_be_managed_by_staff: boolean | null;
  published: Record<string, boolean> | null;
};

type AccessResult =
  | {
      ok: true;
      userId: string;
      project: PaperScanProject;
      admin: ReturnType<typeof getAdminClient>;
    }
  | { ok: false; error: string };

/** Every action re-derives authorization; none trusts a client-supplied id. */
async function requirePaperScanAccess(
  projectId: string,
): Promise<AccessResult> {
  const { user, error: authError } = await getAuthUser();
  if (authError || !user) {
    return { ok: false, error: "Authentication required." };
  }

  const admin = getAdminClient();
  const { data: project, error: projectError } = await admin
    .from("projects")
    .select(
      "id, creator_id, organization_id, can_be_managed_by_staff, status, event_type, schedule, project_timezone, title, location, published, verification_method",
    )
    .eq("id", projectId)
    .single();
  if (projectError || !project) {
    return { ok: false, error: "Project not found." };
  }

  let organizationRole: string | null = null;
  if (project.organization_id && project.creator_id !== user.id) {
    const { data: membership } = await admin
      .from("organization_members")
      .select("role, status")
      .eq("organization_id", project.organization_id)
      .eq("user_id", user.id)
      .maybeSingle();
    organizationRole = activeOrganizationRole(membership);
  }

  if (
    !canManageProjectAccess({
      creatorId: project.creator_id,
      userId: user.id,
      organizationRole,
      canBeManagedByStaff: project.can_be_managed_by_staff ?? false,
    })
  ) {
    return { ok: false, error: "Not authorized to manage this project." };
  }

  return {
    ok: true,
    userId: user.id,
    project: project as unknown as PaperScanProject,
    admin,
  };
}

const OBJECT_PATH_SEGMENT = "[0-9a-fA-F-]{36}";

const createBatchSchema = z
  .object({
    projectId: z.string().uuid(),
    scheduleId: z.string().trim().min(1).max(200),
    images: z
      .array(
        z
          .object({
            objectPath: z.string().min(1).max(500),
            sequence: z
              .number()
              .int()
              .min(0)
              .max(PAPER_SCAN_MAX_IMAGES - 1),
            byteSize: z.number().int().min(1).max(PAPER_SCAN_MAX_IMAGE_BYTES),
            contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
          })
          .strict(),
      )
      .min(1)
      .max(PAPER_SCAN_MAX_IMAGES),
  })
  .strict();

export async function createPaperScanBatch(input: {
  projectId: string;
  scheduleId: string;
  images: Array<{
    objectPath: string;
    sequence: number;
    byteSize: number;
    contentType: string;
  }>;
}): Promise<{ batchId: string } | { error: string }> {
  const parsed = createBatchSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid scan batch request." };
  }
  const { projectId, images } = parsed.data;

  const access = await requirePaperScanAccess(projectId);
  if (!access.ok) return { error: access.error };
  const { admin, project, userId } = access;

  // The path prefix binds each object to this project; without this check a
  // caller could register another project's photos into their own batch.
  const pathPattern = new RegExp(
    `^paper_signups/${projectId}/${OBJECT_PATH_SEGMENT}/[0-9]+_[A-Za-z0-9_-]+\\.(jpg|jpeg|png|webp)$`,
  );
  if (!images.every((image) => pathPattern.test(image.objectPath))) {
    return {
      error: "One or more uploaded photos are not valid for this project.",
    };
  }

  const scheduleId = resolveScheduleId(project, parsed.data.scheduleId);
  if (!getAttendanceScheduleWindow(project, scheduleId)) {
    return { error: "That schedule slot could not be resolved." };
  }

  const { data: batch, error: batchError } = await admin
    .from("project_paper_scan_batches")
    .insert({
      project_id: projectId,
      schedule_id: scheduleId,
      created_by: userId,
      status: "draft",
      image_count: images.length,
    })
    .select("id")
    .single();
  if (batchError || !batch) {
    return { error: "Could not create the scan batch." };
  }

  const { error: imagesError } = await admin
    .from("project_paper_scan_images")
    .insert(
      images.map((image) => ({
        batch_id: batch.id,
        project_id: projectId,
        object_path: image.objectPath,
        sequence: image.sequence,
        byte_size: image.byteSize,
        content_type: image.contentType,
      })),
    );
  if (imagesError) {
    await admin.from("project_paper_scan_batches").delete().eq("id", batch.id);
    return { error: "Could not register the uploaded photos." };
  }

  return { batchId: batch.id };
}

const orphanCleanupSchema = z
  .object({
    projectId: z.string().uuid(),
    objectPaths: z
      .array(z.string().min(1).max(500))
      .min(1)
      .max(PAPER_SCAN_MAX_IMAGES),
  })
  .strict();

/**
 * Record uploads that succeeded before a batch could be created. The browser
 * may still delete them immediately, but the service-only outbox is the durable
 * recovery path when that best-effort removal or its response is lost.
 */
export async function queueOrphanedPaperScanUploads(input: {
  projectId: string;
  objectPaths: string[];
}): Promise<{ success: true } | { error: string }> {
  const parsed = orphanCleanupSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid scan cleanup request." };

  const access = await requirePaperScanAccess(parsed.data.projectId);
  if (!access.ok) return { error: access.error };

  const pathPattern = new RegExp(
    `^paper_signups/${parsed.data.projectId}/${OBJECT_PATH_SEGMENT}/[0-9]+_[A-Za-z0-9_-]+\\.(jpg|jpeg|png|webp)$`,
  );
  if (!parsed.data.objectPaths.every((path) => pathPattern.test(path))) {
    return { error: "Invalid scan cleanup path." };
  }

  const { error } = await access.admin
    .from("paper_scan_storage_deletion_queue")
    .upsert(
      parsed.data.objectPaths.map((objectPath) => ({
        bucket_id: "paper-signup-scans",
        object_path: objectPath,
      })),
      { onConflict: "bucket_id,object_path", ignoreDuplicates: true },
    );
  return error ? { error: "Could not queue scan cleanup." } : { success: true };
}

const updateRowSchema = z
  .object({
    projectId: z.string().uuid(),
    batchId: z.string().uuid(),
    rowId: z.string().uuid(),
    patch: z
      .object({
        name: z.string().trim().max(200).nullable().optional(),
        email: z.string().trim().max(320).nullable().optional(),
        phone: z.string().trim().max(40).nullable().optional(),
        checkInTime: z.string().datetime().nullable().optional(),
        checkOutTime: z.string().datetime().nullable().optional(),
        signaturePresent: z.boolean().optional(),
        decision: z.enum(["pending", "include", "exclude"]).optional(),
        matchSignupId: z.string().uuid().nullable().optional(),
      })
      .strict(),
  })
  .strict();

export async function updatePaperScanRow(input: {
  projectId: string;
  batchId: string;
  rowId: string;
  patch: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    checkInTime?: string | null;
    checkOutTime?: string | null;
    signaturePresent?: boolean;
    decision?: "pending" | "include" | "exclude";
    matchSignupId?: string | null;
  };
}): Promise<{ success: true } | { error: string }> {
  const parsed = updateRowSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid row update." };
  }
  const { projectId, batchId, rowId, patch } = parsed.data;

  const access = await requirePaperScanAccess(projectId);
  if (!access.ok) return { error: access.error };
  const { admin } = access;

  const { data: batch } = await admin
    .from("project_paper_scan_batches")
    .select("id, status, project_id")
    .eq("id", batchId)
    .eq("project_id", projectId)
    .single();
  if (!batch) return { error: "Batch not found." };
  if (batch.status !== "review") {
    return { error: "This batch is not in review." };
  }

  const email =
    patch.email === undefined
      ? undefined
      : patch.email === null || patch.email.length === 0
        ? null
        : patch.email.toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "That email address doesn't look valid." };
  }

  // raw_extraction is never touched: the AI's output stays immutable
  // evidence, separate from the reviewer's working copy.
  const { error: updateError } = await admin
    .from("project_paper_scan_rows")
    .update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
      ...(patch.checkInTime !== undefined
        ? { check_in_time: patch.checkInTime }
        : {}),
      ...(patch.checkOutTime !== undefined
        ? { check_out_time: patch.checkOutTime }
        : {}),
      ...(patch.signaturePresent !== undefined
        ? { signature_present: patch.signaturePresent }
        : {}),
      ...(patch.decision !== undefined ? { decision: patch.decision } : {}),
      ...(patch.matchSignupId !== undefined
        ? { match_signup_id: patch.matchSignupId }
        : {}),
    })
    .eq("id", rowId)
    .eq("batch_id", batchId);
  if (updateError) {
    return {
      error:
        updateError.code === "23514"
          ? "Check-out must be after check-in."
          : "Could not save the row.",
    };
  }

  return { success: true };
}

export async function getPaperScanImageUrls(input: {
  projectId: string;
  batchId: string;
}): Promise<
  | { urls: Array<{ imageId: string; sequence: number; url: string }> }
  | { error: string }
> {
  const access = await requirePaperScanAccess(input.projectId);
  if (!access.ok) return { error: access.error };
  const { admin } = access;

  const { data: images } = await admin
    .from("project_paper_scan_images")
    .select("id, object_path, sequence")
    .eq("batch_id", input.batchId)
    .eq("project_id", input.projectId)
    .is("purged_at", null)
    .order("sequence");
  if (!images || images.length === 0) return { urls: [] };

  const { data: signed, error: signError } = await admin.storage
    .from("paper-signup-scans")
    .createSignedUrls(
      images.map((image) => image.object_path),
      900,
    );
  if (signError || !signed) {
    return { error: "Could not load the scan photos." };
  }

  return {
    urls: images.flatMap((image, index) => {
      const url = signed[index]?.signedUrl;
      return url ? [{ imageId: image.id, sequence: image.sequence, url }] : [];
    }),
  };
}

const commitSchema = z
  .object({
    projectId: z.string().uuid(),
    batchId: z.string().uuid(),
    rowIds: z
      .array(z.string().uuid())
      .min(1)
      .max(PAPER_SCAN_MAX_ROWS_PER_BATCH),
    allowOverCapacity: z.boolean(),
    idempotencyKey: z.string().uuid(),
  })
  .strict();

type CommitRpcRow = {
  row_id: string;
  outcome: string;
  signup_id: string | null;
  anonymous_id: string | null;
  user_id: string | null;
  over_capacity: boolean;
  detail: string | null;
};

export async function commitPaperScanBatch(input: {
  projectId: string;
  batchId: string;
  rowIds: string[];
  allowOverCapacity: boolean;
  idempotencyKey: string;
}): Promise<
  | {
      success: true;
      created: number;
      updated: number;
      rosterOnly: number;
      overCapacity: number;
      failed: Array<{ rowId: string; detail: string }>;
      certificatesIssued: number;
      notificationsQueued: number;
    }
  | { error: string }
> {
  const parsed = commitSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid commit request." };
  }
  const { projectId, batchId, rowIds, allowOverCapacity, idempotencyKey } =
    parsed.data;

  const access = await requirePaperScanAccess(projectId);
  if (!access.ok) return { error: access.error };
  const { admin, project, userId } = access;

  const { data: batch } = await admin
    .from("project_paper_scan_batches")
    .select("id, schedule_id, project_id")
    .eq("id", batchId)
    .eq("project_id", projectId)
    .single();
  if (!batch) return { error: "Batch not found." };

  const { data: rpcRows, error: rpcError } = await admin.rpc(
    "commit_paper_signup_batch",
    {
      p_batch_id: batchId,
      p_actor_id: userId,
      p_row_ids: rowIds,
      p_allow_over_capacity: allowOverCapacity,
      p_idempotency_key: idempotencyKey,
    },
  );
  if (rpcError) {
    console.error("Paper commit RPC failed:", rpcError.message);
    return { error: "The commit failed. Nothing was recorded." };
  }

  const results = (rpcRows ?? []) as CommitRpcRow[];
  const created = results.filter((row) => row.outcome === "signup_created");
  const updated = results.filter((row) => row.outcome === "signup_updated");
  const rosterOnly = results.filter((row) => row.outcome === "roster_only");
  const failed = results
    .filter((row) => row.outcome === "failed")
    .map((row) => ({ rowId: row.row_id, detail: row.detail ?? "failed" }));

  // The commit trigger creates one immutable notification outbox item for
  // every new anonymous identity in the same transaction. Delivery is handled
  // by a separately enabled worker; this action never sends inline.
  const newAnonymousIds = [
    ...new Set(
      created
        .map((row) => row.anonymous_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  // A session that already published its hours will never re-run
  // certificate issuance for these signups; do it here.
  let certificatesIssued = 0;
  const publishKey = getPublishStateKey(project, batch.schedule_id);
  if (project.published?.[publishKey] === true) {
    const committedSignupIds = [...created, ...updated]
      .map((row) => row.signup_id)
      .filter((id): id is string => Boolean(id));
    const issuance = await issueCertificatesForSignups({
      projectId,
      scheduleId: batch.schedule_id,
      signupIds: committedSignupIds,
      actorId: userId,
    });
    certificatesIssued = issuance.issued;
  }

  return {
    success: true,
    created: created.length,
    updated: updated.length,
    rosterOnly: rosterOnly.length,
    overCapacity: results.filter((row) => row.over_capacity).length,
    failed,
    certificatesIssued,
    notificationsQueued: newAnonymousIds.length,
  };
}

export async function discardPaperScanBatch(input: {
  projectId: string;
  batchId: string;
}): Promise<{ success: true } | { error: string }> {
  const access = await requirePaperScanAccess(input.projectId);
  if (!access.ok) return { error: access.error };
  const { admin } = access;

  const { data: batch } = await admin
    .from("project_paper_scan_batches")
    .select("id, status")
    .eq("id", input.batchId)
    .eq("project_id", input.projectId)
    .single();
  if (!batch) return { error: "Batch not found." };
  if (batch.status === "committed") {
    return { error: "A committed batch cannot be discarded." };
  }

  // Photos are never deleted inline: enqueue for the cleanup worker so the
  // database and Storage can never disagree.
  const { data: images } = await admin
    .from("project_paper_scan_images")
    .select("bucket_id, object_path")
    .eq("batch_id", input.batchId)
    .is("purged_at", null);
  if (images && images.length > 0) {
    await admin.from("paper_scan_storage_deletion_queue").upsert(
      images.map((image) => ({
        bucket_id: image.bucket_id,
        object_path: image.object_path,
      })),
      { onConflict: "bucket_id,object_path", ignoreDuplicates: true },
    );
    await admin
      .from("project_paper_scan_images")
      .update({ purged_at: new Date().toISOString() })
      .eq("batch_id", input.batchId)
      .is("purged_at", null);
  }

  const { error: updateError } = await admin
    .from("project_paper_scan_batches")
    .update({ status: "discarded" })
    .eq("id", input.batchId);
  if (updateError) return { error: "Could not discard the batch." };

  return { success: true };
}
