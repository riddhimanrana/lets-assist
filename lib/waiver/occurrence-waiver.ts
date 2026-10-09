import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { WAIVER_SOURCE_BUCKET } from "./source-pdf-loader";

/**
 * Gives a generated occurrence of a repeating project its own waiver.
 *
 * An occurrence is a new project, and the database only accepts a waiver PDF
 * stored under the project's own prefix. So the occurrence is inserted as a
 * draft, receives its own copy of the series' PDF and its own definition
 * version, and is published by `publish_waiver_staged_project`, which proves
 * the stored object and the signing configuration before the row becomes
 * visible. Those are the same database functions the create flow ends in.
 *
 * Every privileged call here names the series parent being processed or the
 * occurrence that belongs to it. Storage paths are built from those ids; the
 * parent's stored path is only used after it is checked against the parent's
 * own prefix.
 *
 * The caller has no user session. The actor passed to the database functions
 * is the series creator, who owns every occurrence of the series.
 */

type ServiceClient = Pick<SupabaseClient, "from" | "rpc" | "storage">;

export type OccurrenceWaiverFailureCode =
  | "parent_creator_missing"
  | "parent_waiver_source_missing"
  | "parent_waiver_definition_unavailable"
  | "occurrence_lookup_failed"
  | "occurrence_create_failed"
  | "waiver_copy_failed"
  | "waiver_attach_failed"
  | "waiver_definition_save_failed"
  | "waiver_publish_failed"
  | "waiver_publish_blocked";

/** Why the database refused to publish, as `publish_waiver_staged_project` names it. */
const PUBLICATION_BLOCKERS = new Set([
  "invalid_input",
  "project_not_found",
  "forbidden",
  "not_waiver_project",
  "invalid_state",
  "missing_waiver_source",
  "missing_storage_object",
  "missing_waiver_definition",
  "definition_source_mismatch",
  "definition_missing_signature_field",
  "no_signing_mode",
]);

export type ParentWaiverProject = {
  id: string;
  creator_id?: string | null;
  waiver_pdf_storage_path?: string | null;
  waiver_definition_id?: string | null;
  waiver_disable_esignature?: boolean | null;
};

export type ParentWaiverSource = {
  parentId: string;
  /** The series creator, passed as the actor to the database functions. */
  actorId: string;
  sourcePath: string;
  definition: { title: string; signers: unknown[]; fields: unknown[] } | null;
};

export type OccurrenceWaiverOutcome =
  | { status: "published"; occurrenceId: string }
  /** Another run already owns this occurrence. */
  | { status: "skipped" }
  | {
      status: "failed";
      code: OccurrenceWaiverFailureCode;
      /** Set with `waiver_publish_blocked`. */
      blocker?: string;
      occurrenceId?: string;
    };

export type ResumedOccurrenceOutcome = {
  occurrenceDate: string;
  outcome: OccurrenceWaiverOutcome;
};

type OccurrenceDraft = {
  id: string;
  waiver_pdf_storage_path?: string | null;
  waiver_definition_id?: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
/** More unfinished occurrences than a four-week window can hold. */
const RESUME_LIMIT = 50;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** True when `path` names an object under this project's own waiver prefix. */
function isOwnWaiverPath(projectId: string, path: unknown): path is string {
  if (!isUuid(projectId) || typeof path !== "string") return false;
  const prefix = `project_waivers/${projectId}/`;
  return path.startsWith(prefix) && path.length > prefix.length;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "23505"
  );
}

/**
 * Reads the waiver the series has right now. Occurrences generated in this
 * run copy this state; occurrences generated earlier keep what they copied.
 */
export async function readParentWaiverSource(
  client: ServiceClient,
  parent: ParentWaiverProject,
): Promise<
  | { ok: true; source: ParentWaiverSource }
  | { ok: false; code: OccurrenceWaiverFailureCode }
> {
  if (!isUuid(parent.creator_id)) {
    return { ok: false, code: "parent_creator_missing" };
  }

  if (!isOwnWaiverPath(parent.id, parent.waiver_pdf_storage_path)) {
    return { ok: false, code: "parent_waiver_source_missing" };
  }
  const sourcePath = parent.waiver_pdf_storage_path;

  if (!parent.waiver_definition_id) {
    // E-signatures need signature placements. Without them the database would
    // refuse every occurrence, so none is staged.
    return parent.waiver_disable_esignature === true
      ? {
          ok: true,
          source: {
            parentId: parent.id,
            actorId: parent.creator_id,
            sourcePath,
            definition: null,
          },
        }
      : { ok: false, code: "parent_waiver_definition_unavailable" };
  }

  const { data, error } = await client
    .from("waiver_definitions")
    .select("id, title, signers, fields, pdf_storage_path")
    .eq("id", parent.waiver_definition_id)
    .eq("project_id", parent.id)
    .maybeSingle();

  const definition = data as {
    title?: unknown;
    signers?: unknown;
    fields?: unknown;
    pdf_storage_path?: unknown;
  } | null;

  if (
    error ||
    !definition ||
    definition.pdf_storage_path !== sourcePath ||
    !Array.isArray(definition.signers) ||
    !Array.isArray(definition.fields)
  ) {
    return { ok: false, code: "parent_waiver_definition_unavailable" };
  }

  const title =
    typeof definition.title === "string" && definition.title.trim().length > 0
      ? definition.title.trim()
      : "Project Waiver";

  return {
    ok: true,
    source: {
      parentId: parent.id,
      actorId: parent.creator_id,
      sourcePath,
      definition: {
        title,
        signers: definition.signers,
        fields: definition.fields,
      },
    },
  };
}

/**
 * Hands an object nothing points at to the existing deletion queue. The queue
 * rechecks references before anything is removed, so this can never delete a
 * PDF a project, definition or signature still names.
 */
async function queueUnusedCopy(
  client: ServiceClient,
  occurrenceId: string,
  path: string,
): Promise<void> {
  if (!isOwnWaiverPath(occurrenceId, path)) return;
  try {
    await client.rpc("enqueue_superseded_waiver_source", {
      p_object_path: path,
    });
  } catch {
    // The object stays in storage, unreferenced. Nothing can read it.
  }
}

/**
 * Finishes a draft occurrence: its own PDF copy, its own definition version,
 * then publication. Each step is skipped when an earlier run already did it,
 * so calling this again on the same draft converges on one published row.
 */
async function completeOccurrenceWaiver(
  client: ServiceClient,
  source: ParentWaiverSource,
  draft: OccurrenceDraft,
): Promise<OccurrenceWaiverOutcome> {
  const occurrenceId = draft.id;
  const fail = (
    code: OccurrenceWaiverFailureCode,
    blocker?: string,
  ): OccurrenceWaiverOutcome => ({
    status: "failed",
    code,
    occurrenceId,
    ...(blocker ? { blocker } : {}),
  });

  if (!isUuid(occurrenceId)) return fail("occurrence_create_failed");

  const previousPath = isOwnWaiverPath(
    occurrenceId,
    draft.waiver_pdf_storage_path,
  )
    ? draft.waiver_pdf_storage_path
    : null;
  const waiverAttached =
    previousPath !== null &&
    (source.definition === null || Boolean(draft.waiver_definition_id));

  if (!waiverAttached) {
    // A draft that stopped between the copy and the definition is rebuilt
    // from the series' current waiver, so the PDF and the signature
    // placements always come from the same version.
    const bucket = client.storage.from(WAIVER_SOURCE_BUCKET);
    const copyPath = `project_waivers/${occurrenceId}/${randomUUID()}.pdf`;

    const { error: copyError } = await bucket.copy(source.sourcePath, copyPath);
    if (copyError) return fail("waiver_copy_failed");

    const { data: attached, error: attachError } = await client
      .from("projects")
      .update({
        waiver_pdf_storage_path: copyPath,
        waiver_pdf_url: bucket.getPublicUrl(copyPath).data.publicUrl,
      })
      .eq("id", occurrenceId)
      .eq("recurrence_parent_id", source.parentId)
      .eq("workflow_status", "draft")
      .select("id")
      .maybeSingle();

    if (
      attachError ||
      (attached as { id?: unknown } | null)?.id !== occurrenceId
    ) {
      await queueUnusedCopy(client, occurrenceId, copyPath);
      return fail("waiver_attach_failed");
    }

    if (previousPath) {
      await queueUnusedCopy(client, occurrenceId, previousPath);
    }

    if (source.definition) {
      const { data: definitionId, error: definitionError } = await client.rpc(
        "save_project_waiver_definition_version",
        {
          p_project_id: occurrenceId,
          p_actor_id: source.actorId,
          p_title: source.definition.title,
          p_signers: source.definition.signers,
          p_fields: source.definition.fields,
        },
      );

      if (definitionError || !definitionId) {
        return fail("waiver_definition_save_failed");
      }
    }
  }

  const { data: publication, error: publishError } = await client.rpc(
    "publish_waiver_staged_project",
    { p_project_id: occurrenceId, p_actor_id: source.actorId },
  );

  if (publishError) return fail("waiver_publish_failed");

  const outcome = (publication as { outcome?: unknown }[] | null)?.[0]?.outcome;
  if (outcome === "published" || outcome === "already_published") {
    return { status: "published", occurrenceId };
  }

  return fail(
    "waiver_publish_blocked",
    typeof outcome === "string" && PUBLICATION_BLOCKERS.has(outcome)
      ? outcome
      : "unknown",
  );
}

/**
 * Creates one occurrence of a waiver-required series.
 *
 * The row is always inserted as a draft, whatever the payload says, and only
 * the database publishes it. A failure after the insert leaves that draft
 * behind for `resumeWaiverOccurrenceDrafts` to finish on a later run.
 */
export async function createWaiverOccurrence(
  client: ServiceClient,
  source: ParentWaiverSource,
  occurrence: Record<string, unknown>,
): Promise<OccurrenceWaiverOutcome> {
  const { data, error } = await client
    .from("projects")
    .insert({
      ...occurrence,
      recurrence_parent_id: source.parentId,
      waiver_required: true,
      workflow_status: "draft",
    })
    .select("id")
    .single();

  if (error) {
    // The unique index on parent and occurrence date: another run got here
    // first and will finish the row, or the next run resumes it.
    return isUniqueViolation(error)
      ? { status: "skipped" }
      : { status: "failed", code: "occurrence_create_failed" };
  }

  const occurrenceId = (data as { id?: unknown } | null)?.id;
  if (!isUuid(occurrenceId)) {
    return { status: "failed", code: "occurrence_create_failed" };
  }

  return completeOccurrenceWaiver(client, source, { id: occurrenceId });
}

/**
 * Finishes the series' occurrences that an earlier run left as drafts.
 *
 * Only future, waiver-required, uncancelled drafts of this parent are
 * touched. A draft the organizer has since cancelled or taken the waiver off
 * is theirs to publish from its edit page.
 */
export async function resumeWaiverOccurrenceDrafts(
  client: ServiceClient,
  source: ParentWaiverSource,
  /**
   * YYYY-MM-DD, the current date in the series' own time zone. Occurrences
   * dated today or earlier are never published.
   */
  today: string,
): Promise<
  | { ok: true; resumed: ResumedOccurrenceOutcome[] }
  | { ok: false; code: OccurrenceWaiverFailureCode }
> {
  if (!CALENDAR_DATE_PATTERN.test(today)) {
    return { ok: false, code: "occurrence_lookup_failed" };
  }

  const { data, error } = await client
    .from("projects")
    .select(
      "id, status, waiver_required, waiver_pdf_storage_path, waiver_definition_id, recurrence_occurrence_date",
    )
    .eq("recurrence_parent_id", source.parentId)
    .eq("workflow_status", "draft")
    .eq("waiver_required", true)
    .gt("recurrence_occurrence_date", today)
    .or("status.is.null,status.neq.cancelled")
    .order("recurrence_occurrence_date", { ascending: true })
    .order("id", { ascending: true })
    .limit(RESUME_LIMIT);

  if (error) return { ok: false, code: "occurrence_lookup_failed" };

  // The query already excludes ineligible drafts, so the cap only ever counts
  // rows that can be resumed. The checks below repeat it on what came back.
  const resumed: ResumedOccurrenceOutcome[] = [];
  for (const row of (data ?? []) as Array<
    OccurrenceDraft & {
      status?: unknown;
      waiver_required?: unknown;
      recurrence_occurrence_date?: unknown;
    }
  >) {
    const occurrenceDate = row.recurrence_occurrence_date;
    if (
      typeof occurrenceDate !== "string" ||
      !CALENDAR_DATE_PATTERN.test(occurrenceDate) ||
      occurrenceDate <= today ||
      row.waiver_required !== true ||
      row.status === "cancelled"
    ) {
      continue;
    }

    resumed.push({
      occurrenceDate,
      outcome: await completeOccurrenceWaiver(client, source, row),
    });
  }

  return { ok: true, resumed };
}
