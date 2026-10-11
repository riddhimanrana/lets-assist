import "server-only";

import { revalidatePath } from "next/cache";

import { safeConsole } from "@/lib/safe-console";
import { getAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import type { Project } from "@/types";
import { removeCalendarEventForProject } from "@/utils/calendar-helpers";

type AdminClient = ReturnType<typeof getAdminClient>;
type ServerClient = Awaited<ReturnType<typeof createClient>>;

const PROJECT_ASSET_BUCKETS = ["project-images", "project-documents"] as const;
type ProjectAssetBucket = (typeof PROJECT_ASSET_BUCKETS)[number];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
/** The only object names the database registers and therefore ever claims. */
const CANONICAL_OBJECT_NAME =
  /^project_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[A-Za-z0-9._-]+$/iu;
/** Storage removals are sent in bounded batches. */
const REMOVAL_BATCH_SIZE = 100;

export type ClaimedProjectAsset = {
  bucket: ProjectAssetBucket;
  name: string;
  objectId: string;
  /** Whether an object is still stored under the claimed name. */
  present: boolean;
};

export type PreparedProjectDeletion = {
  operationId: string;
  projectId: string;
  objects: ClaimedProjectAsset[];
};

/** A deletion the database has already finished for this actor. */
export type CompletedProjectDeletion = {
  operationId: string;
  projectId: string;
};

export type ProjectDeletionRefusal =
  | "forbidden"
  | "signed_waivers"
  | "project_not_found"
  | "asset_limit"
  | "objects_remaining"
  | "failed";

const KNOWN_REFUSALS: readonly string[] = [
  "forbidden",
  "signed_waivers",
  "project_not_found",
  "asset_limit",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function sameUuid(left: unknown, right: string) {
  return isUuid(left) && left.toLowerCase() === right.toLowerCase();
}

function isAssetBucket(value: unknown): value is ProjectAssetBucket {
  return (PROJECT_ASSET_BUCKETS as readonly unknown[]).includes(value);
}

/** One claimed object exactly as the database reports it, or null. */
function readClaimedAsset(value: unknown): ClaimedProjectAsset | null {
  if (!isRecord(value)) return null;
  const { bucket, name, objectId, present } = value;
  if (
    !isAssetBucket(bucket) ||
    typeof name !== "string" ||
    !CANONICAL_OBJECT_NAME.test(name) ||
    !isUuid(objectId) ||
    typeof present !== "boolean"
  ) {
    return null;
  }
  return { bucket, name, objectId, present };
}

function refusalFrom(data: unknown): ProjectDeletionRefusal {
  const outcome = isRecord(data) ? data.outcome : null;
  return typeof outcome === "string" && KNOWN_REFUSALS.includes(outcome)
    ? (outcome as ProjectDeletionRefusal)
    : "failed";
}

/**
 * Starts or resumes the project's one deletion. The database reauthorizes the
 * actor, freezes the project's files, and names the exact Storage objects this
 * deletion may remove. Nothing is derived from a URL or a file name here.
 *
 * When the project is already gone, the same call returns the actor's own
 * completed receipt, which is how a lost final response is confirmed.
 *
 * With `replayOnly` the database only reads that receipt. It begins nothing
 * and claims nothing, whatever the state of the project, and any answer other
 * than an exact completed receipt is treated as "not found".
 */
export async function prepareProjectDeletion(
  admin: AdminClient,
  projectId: string,
  actorId: string,
  options: { replayOnly?: boolean } = {},
): Promise<
  | { prepared: PreparedProjectDeletion }
  | { completed: CompletedProjectDeletion }
  | { refusal: ProjectDeletionRefusal }
> {
  // The identifier is cast to uuid by the database; anything else is not a
  // project and is not sent.
  if (!isUuid(projectId)) return { refusal: "project_not_found" };

  const replayOnly = options.replayOnly === true;
  let data: unknown;
  try {
    const result = await admin.rpc("prepare_project_deletion", {
      p_project_id: projectId,
      p_actor_id: actorId,
      p_replay_only: replayOnly,
    });
    if (result.error) {
      safeConsole.error("Error preparing project deletion:", result.error);
      return { refusal: "failed" };
    }
    data = result.data;
  } catch (error) {
    safeConsole.error("Error preparing project deletion:", error);
    return { refusal: "failed" };
  }

  // The database returns a completed receipt only to the actor who completed
  // this project's deletion. It is accepted only when it names this exact
  // project and a completed phase.
  if (isRecord(data) && data.outcome === "completed") {
    return isUuid(data.operationId) &&
      sameUuid(data.projectId, projectId) &&
      data.phase === "completed"
      ? { completed: { operationId: data.operationId, projectId } }
      : { refusal: "failed" };
  }

  // A read-only replay never yields an open deletion. If one came back, it is
  // not acted on.
  if (replayOnly) return { refusal: "project_not_found" };

  if (
    !isRecord(data) ||
    (data.outcome !== "prepared" && data.outcome !== "resumed")
  ) {
    return { refusal: refusalFrom(data) };
  }

  // The receipt must be for this exact project and still open. Anything else
  // is treated as no receipt at all.
  if (
    !isUuid(data.operationId) ||
    !sameUuid(data.projectId, projectId) ||
    data.phase !== "pending" ||
    !Array.isArray(data.objects)
  ) {
    return { refusal: "failed" };
  }

  const objects: ClaimedProjectAsset[] = [];
  for (const entry of data.objects) {
    const asset = readClaimedAsset(entry);
    if (!asset) return { refusal: "failed" };
    objects.push(asset);
  }

  return {
    prepared: { operationId: data.operationId, projectId, objects },
  };
}

/**
 * Asks Storage to remove the claimed objects that are still present. A
 * reported success is not proof: finalizeProjectDeletion checks the catalog.
 * Returns the bucket that failed, or null when every request was accepted.
 */
export async function removeClaimedProjectAssets(
  admin: AdminClient,
  prepared: PreparedProjectDeletion,
): Promise<ProjectAssetBucket | null> {
  for (const bucket of PROJECT_ASSET_BUCKETS) {
    const names = prepared.objects
      .filter((asset) => asset.bucket === bucket && asset.present)
      .map((asset) => asset.name);

    for (let start = 0; start < names.length; start += REMOVAL_BATCH_SIZE) {
      const batch = names.slice(start, start + REMOVAL_BATCH_SIZE);
      try {
        const { error } = await admin.storage.from(bucket).remove(batch);
        if (error) {
          safeConsole.error("Error removing claimed project assets:", error);
          return bucket;
        }
      } catch (error) {
        safeConsole.error("Error removing claimed project assets:", error);
        return bucket;
      }
    }
  }

  return null;
}

/**
 * Completes the deletion. The database confirms every claimed object is gone,
 * reauthorizes the actor, and deletes exactly this project. Returns null only
 * for an exact completed receipt.
 */
export async function finalizeProjectDeletion(
  admin: AdminClient,
  prepared: PreparedProjectDeletion,
  actorId: string,
): Promise<ProjectDeletionRefusal | null> {
  let data: unknown;
  try {
    const result = await admin.rpc("finalize_project_deletion", {
      p_operation_id: prepared.operationId,
      p_project_id: prepared.projectId,
      p_actor_id: actorId,
    });
    if (result.error) {
      safeConsole.error("Error finalizing project deletion:", result.error);
      return "failed";
    }
    data = result.data;
  } catch (error) {
    safeConsole.error("Error finalizing project deletion:", error);
    return "failed";
  }

  if (!isRecord(data)) return "failed";
  if (data.outcome === "objects_remaining") return "objects_remaining";
  if (data.outcome !== "completed") return refusalFrom(data);

  return sameUuid(data.operationId, prepared.operationId) &&
    sameUuid(data.projectId, prepared.projectId) &&
    data.phase === "completed"
    ? null
    : "failed";
}

const PROJECT_DELETION_ERRORS: Record<ProjectDeletionRefusal, string> = {
  forbidden: "You don't have permission to delete this project",
  signed_waivers:
    "Projects with signed waivers must be cancelled and retained until their evidence-retention period ends",
  project_not_found: "Project not found",
  asset_limit:
    "This project has too many stored files to delete in one step. Contact support.",
  objects_remaining:
    "Some project files could not be removed. Try deleting the project again.",
  failed: "Failed to delete project",
};

/** What the caller's own project read reported. */
export type ProjectDeletionRead = {
  project: Pick<
    Project,
    "creator_id" | "organization_id" | "creator_calendar_event_id"
  > | null;
  error: unknown;
  /** True only when the read succeeded and returned no row. */
  absent: boolean;
};

/**
 * The whole deletion of one project for an already signed-in actor.
 *
 * `readProject` is the calling action's own mutation read, passed in so it is
 * neither duplicated here nor exposed as an action of its own.
 */
export async function deleteProjectForActor({
  supabase,
  projectId,
  actorId,
  readProject,
}: {
  supabase: ServerClient;
  projectId: string;
  actorId: string;
  readProject: () => Promise<ProjectDeletionRead>;
}) {
  const {
    project,
    error: projectError,
    absent: projectAbsent,
  } = await readProject();

  if (!project || projectError) {
    // The row may be gone because this actor's own deletion already
    // finished and only the response was lost. The database returns that
    // receipt to the actor who completed it and to nobody else, and it is the
    // only thing consulted here: no file or calendar is touched.
    // Only a read that succeeded and found no row is replayed. A failed read,
    // or one that returned a different project, stops here. The replay itself
    // is read-only in the database, so even a row this read could not see is
    // never put into deletion by it.
    if (projectAbsent) {
      const replay = await prepareProjectDeletion(
        getAdminClient(),
        projectId,
        actorId,
        { replayOnly: true },
      );
      if ("completed" in replay) {
        revalidatePath("/home");
        return { success: true };
      }
    }
    return { error: "Project not found" };
  }

  let hasPermission = project.creator_id === actorId;
  if (project.organization_id && !hasPermission) {
    const { data: orgMember, error: orgMemberError } = await supabase
      .from("organization_members")
      .select("role, status")
      .eq("organization_id", project.organization_id)
      .eq("user_id", actorId)
      .maybeSingle();

    if (orgMemberError) {
      return { error: "Failed to verify project permissions" };
    }

    // Only an explicitly active admin can delete; the database checks again.
    hasPermission =
      orgMember?.status === "active" && orgMember.role === "admin";
  }

  if (!hasPermission) {
    return { error: "You don't have permission to delete this project" };
  }

  const serviceSupabase = getAdminClient();
  const { count: signedWaiverCount, error: signedWaiverError } =
    await serviceSupabase
      .from("waiver_signatures")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId);

  if (signedWaiverError || signedWaiverCount === null) {
    return { error: "Unable to verify the project's waiver-retention state" };
  }

  if (signedWaiverCount > 0) {
    return { error: PROJECT_DELETION_ERRORS.signed_waivers };
  }

  // The database reauthorizes this actor, freezes the project's files, and
  // names the exact Storage objects this deletion may remove: the ones recorded
  // as uploaded for this project (linked or not) and shared ones whose owning
  // project is already gone. A file another project still links, and anything
  // identified only by a URL or a file name, is left in place. The open
  // operation is the retry anchor: a failure below keeps it, and the next call
  // resumes it.
  const preparation = await prepareProjectDeletion(
    serviceSupabase,
    projectId,
    actorId,
  );
  if ("refusal" in preparation) {
    return { error: PROJECT_DELETION_ERRORS[preparation.refusal] };
  }

  // A completed receipt here means the database already finished this actor's
  // deletion; there is nothing left to remove.
  if (!("completed" in preparation)) {
    const failedBucket = await removeClaimedProjectAssets(
      serviceSupabase,
      preparation.prepared,
    );
    if (failedBucket) {
      return {
        error:
          failedBucket === "project-images"
            ? "Failed to clean up the project cover image"
            : "Failed to clean up project documents",
      };
    }

    // The project row still exists here, so calendar cleanup keeps its anchor.
    if (project.creator_calendar_event_id) {
      const calendarResult = await removeCalendarEventForProject(projectId, {
        userId: actorId,
        calendarEventId: project.creator_calendar_event_id,
      });
      if (!calendarResult.success) {
        return { error: "Failed to clean up the project calendar event" };
      }
    }

    // Success is reported only for an exact completed receipt. The database
    // checks the claimed objects are really gone before it deletes the project.
    const finalizeRefusal = await finalizeProjectDeletion(
      serviceSupabase,
      preparation.prepared,
      actorId,
    );
    if (finalizeRefusal) {
      return { error: PROJECT_DELETION_ERRORS[finalizeRefusal] };
    }
  }

  revalidatePath("/home");
  if (project.organization_id) {
    revalidatePath(`/organization/${project.organization_id}`);
  }

  return { success: true };
}
