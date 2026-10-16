import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import {
  findEvidencePlacementProblem,
  waiverSourceSnapshot,
  type StoredWaiverDefinition,
  type WaiverSourceCache,
} from "@/lib/waiver/source-boundary";

export type AnonymousSignupConfirmationResult = {
  outcome: string;
  approvedCount: number;
  blockedProjectId: string | null;
  blockedScheduleId: string | null;
};

export type AnonymousSignupWaiverErrorCode =
  "waiver_evidence_invalid" | "pending_signups_changed" | "waiver_check_failed";

// Fixed sentences. None quotes a document, a name, or a field value.
const WAIVER_ERROR_MESSAGES: Record<AnonymousSignupWaiverErrorCode, string> = {
  waiver_evidence_invalid:
    "Your signup was not confirmed. The signed waiver on file cannot be placed on this project's waiver document. Ask the organizer to correct the waiver, then sign it again to finish signing up.",
  pending_signups_changed:
    "Your signups changed while they were being confirmed, so nothing was confirmed. Open the confirmation link again to retry.",
  waiver_check_failed:
    "The signed waiver for this signup could not be checked, so nothing was confirmed. Open the confirmation link again to retry.",
};

/**
 * Confirmation was refused before any row changed. `pending_signups_changed`
 * and `waiver_check_failed` are safe to retry as they are.
 */
export class AnonymousSignupWaiverError extends Error {
  readonly code: AnonymousSignupWaiverErrorCode;

  constructor(code: AnonymousSignupWaiverErrorCode) {
    super(WAIVER_ERROR_MESSAGES[code]);
    this.name = "AnonymousSignupWaiverError";
    this.code = code;
  }
}

type AdminClient = ReturnType<typeof getAdminClient>;

/** A guest profile holds a handful of pending slots. More is refused. */
const MAX_PENDING_SIGNUPS = 200;

type PendingSignupRow = { id: string; project_id: string };

type ProjectWaiverRow = {
  id: string;
  waiver_required: boolean | null;
  waiver_pdf_storage_path: string | null;
  waiver_pdf_url: string | null;
  project_timezone: string | null;
};

type PendingSignatureRow = {
  id: string;
  signup_id: string | null;
  project_id: string;
  waiver_pdf_storage_path: string | null;
  waiver_pdf_url: string | null;
  signature_payload: unknown;
  signature_storage_path: string | null;
  signature_text: string | null;
  upload_storage_path: string | null;
  signed_at: string | null;
  waiver_definition_id: string | null;
  // PostgREST may report this to-one relation as an object or as an array.
  waiver_definition: unknown;
};

/**
 * The one definition an evidence row was signed against. A row that names no
 * definition has none. A row that names one must come back with exactly that
 * one: a missing or repeated relation is not something to guess around.
 */
function evidenceDefinition(
  signature: PendingSignatureRow,
): { ok: true; definition: StoredWaiverDefinition | null } | { ok: false } {
  const relation = signature.waiver_definition;
  const related = (
    Array.isArray(relation) ? relation : relation == null ? [] : [relation]
  ) as Partial<StoredWaiverDefinition>[];

  if (signature.waiver_definition_id == null) {
    return related.length === 0
      ? { ok: true, definition: null }
      : { ok: false };
  }
  const [definition] = related;
  return related.length === 1 &&
    typeof definition === "object" &&
    definition !== null &&
    definition.id === signature.waiver_definition_id
    ? { ok: true, definition: definition as StoredWaiverDefinition }
    : { ok: false };
}

/** Exactly what the preflight looked at. The transaction rechecks all three. */
type CheckedPendingSignups = {
  signupIds: string[];
  waiverSignupIds: string[];
  signatureIds: string[];
};

/**
 * Proves every pending signup's signed waiver before it can be promoted.
 *
 * Each e-signature is checked against its own immutable snapshot: the source
 * PDF and definition recorded when it was signed. A full signed copy uploaded
 * by the volunteer is its own document and needs no placement. Only the source
 * PDF is read. No signature asset is loaded and no signed copy is produced.
 *
 * Returns the pending signups, the ones whose project required a waiver, and
 * the evidence rows that were judged.
 */
async function checkPendingWaiverEvidence(
  admin: AdminClient,
  anonymousSignupId: string,
): Promise<
  | { checked: CheckedPendingSignups; error: null }
  | { checked: null; error: AnonymousSignupWaiverError }
> {
  const refuse = (code: AnonymousSignupWaiverErrorCode) => ({
    checked: null,
    error: new AnonymousSignupWaiverError(code),
  });
  const accept = (
    signupIds: string[],
    waiverSignupIds: string[],
    signatureIds: string[],
  ) => ({
    checked: {
      signupIds,
      waiverSignupIds: [...waiverSignupIds].sort(),
      signatureIds: [...signatureIds].sort(),
    },
    error: null,
  });

  const { data: pendingData, error: pendingError } = await admin
    .from("project_signups")
    .select("id, project_id")
    .eq("anonymous_id", anonymousSignupId)
    .eq("status", "pending")
    .order("id")
    .limit(MAX_PENDING_SIGNUPS + 1);

  if (pendingError) return refuse("waiver_check_failed");
  const pending = (
    Array.isArray(pendingData) ? pendingData : []
  ) as PendingSignupRow[];
  if (pending.length > MAX_PENDING_SIGNUPS) {
    return refuse("waiver_check_failed");
  }
  const checkedSignupIds = pending.map((signup) => signup.id);
  if (pending.length === 0) return accept(checkedSignupIds, [], []);

  const projects = new Map<string, ProjectWaiverRow>();
  for (const projectId of new Set(pending.map((signup) => signup.project_id))) {
    const { data: project, error: projectError } = await admin
      .from("projects")
      .select(
        "id, waiver_required, waiver_pdf_storage_path, waiver_pdf_url, project_timezone",
      )
      .eq("id", projectId)
      .maybeSingle();

    if (projectError || !project) return refuse("waiver_check_failed");
    projects.set(projectId, project as ProjectWaiverRow);
  }

  const waiverSignups = pending.filter(
    (signup) => projects.get(signup.project_id)?.waiver_required === true,
  );
  if (waiverSignups.length === 0) return accept(checkedSignupIds, [], []);

  const { data: signatureData, error: signatureError } = await admin
    .from("waiver_signatures")
    .select(
      `
      id,
      signup_id,
      project_id,
      waiver_pdf_storage_path,
      waiver_pdf_url,
      signature_payload,
      signature_storage_path,
      signature_text,
      upload_storage_path,
      signed_at,
      waiver_definition_id,
      waiver_definition:waiver_definitions (
        id,
        pdf_storage_path,
        pdf_public_url,
        signers,
        fields
      )
    `,
    )
    .in(
      "signup_id",
      waiverSignups.map((signup) => signup.id),
    );

  if (signatureError) return refuse("waiver_check_failed");
  const signatures = (Array.isArray(signatureData)
    ? signatureData
    : []) as unknown as PendingSignatureRow[];

  const sources: WaiverSourceCache = new Map();
  const judgedSignatureIds: string[] = [];
  for (const signup of waiverSignups) {
    const project = projects.get(signup.project_id)!;
    const evidence = signatures.filter(
      (signature) =>
        signature.signup_id === signup.id &&
        signature.project_id === signup.project_id,
    );
    // A waiver-required signup with no evidence is never promoted.
    if (evidence.length === 0) return refuse("waiver_evidence_invalid");

    for (const signature of evidence) {
      judgedSignatureIds.push(signature.id);
      if (signature.upload_storage_path) continue;

      const related = evidenceDefinition(signature);
      if (!related.ok) return refuse("waiver_evidence_invalid");
      const { definition } = related;
      // The evidence's own historical source: its snapshot, or the source of
      // the immutable definition it was signed against. A later definition
      // version does not invalidate it. The project's current PDF is never
      // used: it can be replaced, so it cannot prove what was signed. Evidence
      // with no provenance of its own is refused, and the volunteer has to
      // sign again through the authorized signing flow.
      const source = waiverSourceSnapshot(
        signature.waiver_pdf_storage_path ?? definition?.pdf_storage_path,
        signature.waiver_pdf_url ?? definition?.pdf_public_url,
      );
      if (source.storagePath === null && source.publicUrl === null) {
        return refuse("waiver_evidence_invalid");
      }
      const problem = await findEvidencePlacementProblem({
        projectId: signup.project_id,
        source,
        definition,
        evidence: {
          signaturePayload: signature.signature_payload,
          hasDrawnSignature: Boolean(signature.signature_storage_path),
          typedSignatureText: signature.signature_text,
          signedAt: signature.signed_at,
        },
        timeZone: project.project_timezone,
        adminClient: admin,
        cache: sources,
      });
      if (problem) return refuse("waiver_evidence_invalid");
    }
  }

  return accept(
    checkedSignupIds,
    waiverSignups.map((signup) => signup.id),
    judgedSignatureIds,
  );
}

/**
 * Confirms an anonymous profile and promotes all of its pending signups in one
 * capacity-locked database transaction.
 *
 * The signed waiver of every pending signup is proven first. The transaction
 * then promotes only if the pending signups, the ones that require a waiver,
 * and their evidence rows are still exactly what was checked. A signup added
 * in between, a waiver requirement switched on in between, or evidence that
 * changed in between is never promoted unchecked. A refusal changes no row.
 */
export async function confirmAnonymousSignupWithCapacity(
  anonymousSignupId: string,
): Promise<
  | { data: AnonymousSignupConfirmationResult; error: null }
  | { data: null; error: unknown }
> {
  const admin = getAdminClient();
  const preflight = await checkPendingWaiverEvidence(admin, anonymousSignupId);
  if (preflight.error) {
    return { data: null, error: preflight.error };
  }

  const { data, error } = await admin.rpc(
    "confirm_anonymous_signup_with_capacity_checked",
    {
      p_anonymous_id: anonymousSignupId,
      p_checked_signup_ids: preflight.checked.signupIds,
      p_checked_waiver_signup_ids: preflight.checked.waiverSignupIds,
      p_checked_signature_ids: preflight.checked.signatureIds,
    },
  );

  if (error) {
    return { data: null, error };
  }

  type RpcRow = {
    outcome: string;
    approved_count: number;
    blocked_project_id: string | null;
    blocked_schedule_id: string | null;
  };
  const row = (data as RpcRow[] | null)?.[0] ?? null;
  if (!row) {
    return {
      data: null,
      error: new Error("Anonymous signup confirmation returned no result"),
    };
  }

  // The database refused before changing any row. Neither is a confirmation.
  if (row.outcome === "pending_signups_changed") {
    return {
      data: null,
      error: new AnonymousSignupWaiverError("pending_signups_changed"),
    };
  }
  if (row.outcome === "waiver_evidence_missing") {
    return {
      data: null,
      error: new AnonymousSignupWaiverError("waiver_evidence_invalid"),
    };
  }

  return {
    data: {
      outcome: row.outcome,
      approvedCount: row.approved_count,
      blockedProjectId: row.blocked_project_id,
      blockedScheduleId: row.blocked_schedule_id,
    },
    error: null,
  };
}
