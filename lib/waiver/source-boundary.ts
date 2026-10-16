import "server-only";

import {
  SignedWaiverPdfError,
  assertSignedWaiverPlaceable,
} from "./generate-signed-waiver-pdf";
import {
  SYNTHETIC_SINGLE_SIGNER_RECT,
  WaiverSourceGeometryError,
  evidencePlacementFits,
  fieldFitsSource,
  readWaiverSourceGeometry,
  type FieldRect,
  type WaiverPlacementField,
  type WaiverPlacementSigner,
  type WaiverSourceGeometry,
} from "./pdf-geometry";
import {
  WAIVER_SOURCE_BUCKET,
  WaiverSourcePdfError,
  loadWaiverSourcePdf,
  validateLegacyWaiverSourceUrl,
  type WaiverSourceAdminClient,
} from "./source-pdf-loader";
import type { SignaturePayload, SignerData } from "@/types/waiver-definitions";

/**
 * Server checks that tie a waiver definition and waiver evidence to the actual
 * bytes of the project's source PDF. Nothing here trusts page sizes, page
 * counts, or placements reported by a browser, and nothing here moves a
 * configured placement.
 */

export type WaiverBoundaryProblem =
  | "missing_source"
  | "unreadable_source"
  | "encrypted_source"
  | "stale_waiver"
  | "unplaceable_field"
  | "unplaceable_signature"
  | "missing_evidence";

/** Fixed sentences for a volunteer. None quotes the document or a value. */
export const WAIVER_SIGNING_REFUSALS: Record<WaiverBoundaryProblem, string> = {
  missing_source:
    "This project's waiver document is not available, so the waiver cannot be signed online right now. Contact the organizer.",
  unreadable_source:
    "This project's waiver document could not be read, so the waiver cannot be signed online right now. Contact the organizer.",
  encrypted_source:
    "This project's waiver document is password protected, so the waiver cannot be signed online right now. Contact the organizer.",
  stale_waiver:
    "This project's waiver changed. Reload the page and sign the current waiver.",
  unplaceable_field:
    "A required field on this waiver has no valid position on the waiver document. Contact the organizer.",
  unplaceable_signature:
    "A signature on this waiver has no valid position on the waiver document. Contact the organizer.",
  missing_evidence: "The waiver signature is missing or incomplete.",
};

export type WaiverSourceSnapshot = {
  storagePath: string | null;
  publicUrl: string | null;
};

export type StoredWaiverDefinition = {
  id: string;
  pdf_storage_path: string | null;
  pdf_public_url: string | null;
  signers?: unknown;
  fields?: unknown;
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

export function waiverSourceSnapshot(
  storagePath: unknown,
  publicUrl: unknown,
): WaiverSourceSnapshot {
  return { storagePath: text(storagePath), publicUrl: text(publicUrl) };
}

const LEGACY_PUBLIC_PREFIX = `/storage/v1/object/public/${WAIVER_SOURCE_BUCKET}/`;

/**
 * The Storage object a snapshot names. A stored path is authoritative. A row
 * that predates paths names its object through a public URL, which counts only
 * when it is the configured Supabase origin and this project's own prefix: the
 * same rule the loader applies before it reads one.
 */
export function waiverSourceObjectPath(
  projectId: string,
  source: WaiverSourceSnapshot,
): string | null {
  if (source.storagePath !== null) return source.storagePath;

  const configuredSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (source.publicUrl === null || !configuredSupabaseUrl) return null;
  try {
    return validateLegacyWaiverSourceUrl(
      source.publicUrl,
      configuredSupabaseUrl,
      projectId,
    ).pathname.slice(LEGACY_PUBLIC_PREFIX.length);
  } catch {
    return null;
  }
}

/** Whether two snapshots of one project name the same source document. */
export function sameWaiverSource(
  projectId: string,
  a: WaiverSourceSnapshot,
  b: WaiverSourceSnapshot,
): boolean {
  const pathA = waiverSourceObjectPath(projectId, a);
  const pathB = waiverSourceObjectPath(projectId, b);
  if (pathA !== null || pathB !== null) return pathA === pathB;
  return a.publicUrl === b.publicUrl;
}

/**
 * The source snapshot new evidence must carry: the project's current source.
 * A project row that predates paths takes the path from its current
 * definition, but only when both name the same document. The database applies
 * the same rule to every new evidence row.
 */
export function currentEvidenceSource(
  projectId: string,
  project: WaiverSourceSnapshot,
  definition: WaiverSourceSnapshot | null,
): WaiverSourceSnapshot {
  if (!definition || !sameWaiverSource(projectId, definition, project)) {
    return project;
  }
  return {
    storagePath: definition.storagePath ?? project.storagePath,
    publicUrl:
      project.storagePath === null && definition.storagePath === null
        ? project.publicUrl
        : (definition.publicUrl ?? project.publicUrl),
  };
}

type LoadedWaiverSource =
  | { ok: true; bytes: Uint8Array; geometry: WaiverSourceGeometry }
  | { ok: false; problem: WaiverBoundaryProblem };

/** One load per source document within a single request. */
export type WaiverSourceCache = Map<string, Promise<LoadedWaiverSource>>;

async function readSource(
  projectId: string,
  source: WaiverSourceSnapshot,
  adminClient: WaiverSourceAdminClient,
): Promise<LoadedWaiverSource> {
  let bytes: Uint8Array;
  try {
    // The pinned loader: a project-scoped Storage path, or a same-origin
    // legacy public URL. No other location is ever fetched.
    bytes = await loadWaiverSourcePdf(
      {
        projectId,
        storagePath: source.storagePath,
        legacyUrl: source.publicUrl,
      },
      { adminClient },
    );
  } catch (error) {
    return {
      ok: false,
      problem:
        error instanceof WaiverSourcePdfError && error.code === "missing-source"
          ? "missing_source"
          : "unreadable_source",
    };
  }

  try {
    return { ok: true, bytes, geometry: await readWaiverSourceGeometry(bytes) };
  } catch (error) {
    return {
      ok: false,
      problem:
        error instanceof WaiverSourceGeometryError
          ? error.code
          : "unreadable_source",
    };
  }
}

/** Loads and measures the canonical source bytes for a project. */
export function loadCanonicalWaiverSource(
  projectId: string,
  source: WaiverSourceSnapshot,
  adminClient: WaiverSourceAdminClient,
  cache?: WaiverSourceCache,
): Promise<LoadedWaiverSource> {
  // A Storage path is authoritative, so the URL only identifies legacy rows.
  const legacyUrl = source.storagePath === null ? (source.publicUrl ?? "") : "";
  const key = [projectId, source.storagePath ?? "", legacyUrl].join("\n");
  const cached = cache?.get(key);
  if (cached) return cached;

  const loading = readSource(projectId, source, adminClient);
  cache?.set(key, loading);
  return loading;
}

type StoredField = WaiverPlacementField & { field_key: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads stored definition JSON without trusting its shape. */
export function readStoredDefinitionParts(definition: {
  signers?: unknown;
  fields?: unknown;
}): { signers: WaiverPlacementSigner[]; fields: StoredField[] } {
  const signers = (Array.isArray(definition.signers) ? definition.signers : [])
    .filter(isRecord)
    .flatMap((signer) =>
      typeof signer.role_key === "string"
        ? [
            {
              role_key: signer.role_key,
              required:
                typeof signer.required === "boolean"
                  ? signer.required
                  : undefined,
            },
          ]
        : [],
    );
  const fields = (Array.isArray(definition.fields) ? definition.fields : [])
    .filter(isRecord)
    .map((field) => ({
      field_key: typeof field.field_key === "string" ? field.field_key : "",
      field_type: typeof field.field_type === "string" ? field.field_type : "",
      page_index:
        typeof field.page_index === "number" ? field.page_index : null,
      rect: isRecord(field.rect) ? (field.rect as FieldRect) : null,
      signer_role_key:
        typeof field.signer_role_key === "string"
          ? field.signer_role_key
          : null,
      required: field.required === true,
    }));

  return { signers, fields };
}

/**
 * Definition save: every supplied field must sit on a real page of the actual
 * source PDF. Returns null when all of them do.
 */
export async function findDefinitionFieldProblem(input: {
  projectId: string;
  source: WaiverSourceSnapshot;
  fields: ReadonlyArray<Record<string, unknown>>;
  adminClient: WaiverSourceAdminClient;
}): Promise<WaiverBoundaryProblem | null> {
  const loaded = await loadCanonicalWaiverSource(
    input.projectId,
    input.source,
    input.adminClient,
  );
  if (!loaded.ok) return loaded.problem;

  const { fields } = readStoredDefinitionParts({ fields: input.fields });
  return fields.length === input.fields.length &&
    fields.every((field) => fieldFitsSource(field, loaded.geometry))
    ? null
    : "unplaceable_field";
}

/** What was signed, in whichever of the stored shapes the record uses. */
export type WaiverEvidenceShape = {
  signaturePayload: unknown;
  /** A drawn signature image stored outside the payload (legacy single signer). */
  hasDrawnSignature: boolean;
  /** A typed signature stored outside the payload (legacy single signer). */
  typedSignatureText: string | null;
  signedAt: string | null;
};

const SIGNING_METHODS = new Set(["typed", "draw", "upload"]);

function isSigned(signer: SignerData): boolean {
  return (
    SIGNING_METHODS.has(signer.method) &&
    typeof signer.data === "string" &&
    signer.data.trim().length > 0
  );
}

/**
 * The signers the signed-copy renderer will stamp for this evidence, in the
 * same priority order `serveSignedWaiver` uses.
 */
function evidenceSigners(evidence: WaiverEvidenceShape): SignerData[] {
  const payload = evidence.signaturePayload;
  if (isRecord(payload) && Array.isArray(payload.signers)) {
    const signers = payload.signers.filter(
      (signer): signer is SignerData =>
        isRecord(signer) && typeof signer.role_key === "string",
    );
    if (signers.length > 0) return signers;
  }

  const timestamp = evidence.signedAt ?? new Date().toISOString();
  if (evidence.hasDrawnSignature) {
    return [
      {
        role_key: "participant",
        method: "draw",
        data: "stored-signature-image",
        timestamp,
      },
    ];
  }
  if (evidence.typedSignatureText?.trim()) {
    return [
      {
        role_key: "participant",
        method: "typed",
        data: evidence.typedSignatureText,
        timestamp,
      },
    ];
  }
  return [];
}

/**
 * Whether an e-signature has a usable place on the canonical source PDF. A
 * stored definition is judged exactly as saved. A record with no definition
 * is judged by the renderer's own fallback rule, which fits its one box to a
 * short or landscape page and refuses a page too small to hold it.
 *
 * This reads the source PDF and nothing else: no signature asset is loaded and
 * no signed copy is produced. Returns null when the evidence can be stamped.
 */
export async function findEvidencePlacementProblem(input: {
  projectId: string;
  source: WaiverSourceSnapshot;
  definition: StoredWaiverDefinition | null;
  evidence: WaiverEvidenceShape;
  timeZone?: string | null;
  adminClient: WaiverSourceAdminClient;
  cache?: WaiverSourceCache;
}): Promise<WaiverBoundaryProblem | null> {
  const signers = evidenceSigners(input.evidence);
  const signedRoleKeys = signers.filter(isSigned).map((s) => s.role_key);
  if (signedRoleKeys.length === 0) return "missing_evidence";

  const loaded = await loadCanonicalWaiverSource(
    input.projectId,
    input.source,
    input.adminClient,
    input.cache,
  );
  if (!loaded.ok) return loaded.problem;

  if (input.definition) {
    const stored = readStoredDefinitionParts(input.definition);
    return evidencePlacementFits({
      geometry: loaded.geometry,
      signers: stored.signers,
      fields: stored.fields,
      signedRoleKeys,
    })
      ? null
      : "unplaceable_signature";
  }

  const fallbackRole = signers[0].role_key;
  try {
    await assertSignedWaiverPlaceable({
      sourcePdfBytes: loaded.bytes,
      definition: {
        id: "synthetic-single-signer",
        fields: [
          {
            field_key: `${fallbackRole}_signature`,
            field_type: "signature",
            page_index: 0,
            rect: { ...SYNTHETIC_SINGLE_SIGNER_RECT },
            signer_role_key: fallbackRole,
          },
        ],
      },
      signaturePayload: { signers, fields: {} } satisfies SignaturePayload,
      timeZone: input.timeZone,
      fitFallbackSignatureToPage: true,
    });
    return null;
  } catch (error) {
    if (!(error instanceof SignedWaiverPdfError)) return "unreadable_source";
    return error.code === "encrypted_source"
      ? "encrypted_source"
      : error.code === "unplaceable_signature"
        ? "unplaceable_signature"
        : "unreadable_source";
  }
}
