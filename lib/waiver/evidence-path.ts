/**
 * Says whether a stored path is signature evidence this project's sign-up flow
 * could have written.
 *
 * Signed evidence is read with the service role, so a path taken from a
 * signature record must never be trusted on its own: a record that named
 * another project's object would hand that object to whoever may read the
 * record. Every shape the server writes is listed here and nothing else is
 * accepted.
 */
// Signer images written before paths were scoped to their project. The name
// carries a random evidence key and the signer's role key, which an organizer
// chooses, so the role part is matched loosely. It can never hold a slash.
const LEGACY_FLAT_SIGNER_ASSET =
  /^waiver_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[^/\\]{1,160}_\d{10,16}\.(?:png|jpe?g)$/u;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export type WaiverEvidenceFolder =
  "signatures" | "signed-waivers" | "cloned-waiver-evidence";

/**
 * Builds the path for a new piece of signature evidence. Every writer uses
 * this, so what is written and what `isProjectWaiverEvidencePath` accepts
 * cannot drift apart.
 */
export function buildWaiverEvidencePath({
  folder,
  projectId,
  evidenceKey,
  extension,
}: {
  folder: WaiverEvidenceFolder;
  projectId: string;
  evidenceKey: string;
  extension: string;
}): string {
  if (!UUID.test(projectId) || !UUID.test(evidenceKey)) {
    throw new Error("Waiver evidence needs a project id and an evidence key");
  }
  if (!/^[a-z0-9]{2,5}$/u.test(extension)) {
    throw new Error("Unsupported waiver evidence file type");
  }
  return `${folder}/${projectId}/${evidenceKey}/${crypto.randomUUID()}.${extension}`;
}

const SCOPED_FOLDERS: readonly WaiverEvidenceFolder[] = [
  "signatures",
  "signed-waivers",
  "cloned-waiver-evidence",
];

const SCOPED_TAIL =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$/u;

/**
 * Evidence written by this code always sits under its project's own folder.
 * The older flat signer-image name carries no project, so it is accepted only
 * on a record signed before this moment and never on a newer one.
 *
 * The moment is set a little after this change is expected to reach
 * Production, because the release before it still writes the flat name and
 * those waivers must stay readable. Once this code is live the writer refuses
 * any signer value that is not a fresh upload, so nothing new can carry a
 * flat name in the meantime.
 */
export const WAIVER_EVIDENCE_PROJECT_SCOPED_SINCE = Date.parse(
  "2026-11-01T00:00:00Z",
);

function signedBeforeProjectScoping(signedAt: string | null | undefined) {
  if (typeof signedAt !== "string") return false;
  const time = Date.parse(signedAt);
  return Number.isFinite(time) && time < WAIVER_EVIDENCE_PROJECT_SCOPED_SINCE;
}

export function isProjectWaiverEvidencePath(
  path: string | null | undefined,
  projectId: string | null | undefined,
  /** The record's own `signed_at`, which the database never lets change. */
  signedAt?: string | null,
): path is string {
  if (typeof path !== "string" || path.length === 0 || path.length > 300) {
    return false;
  }
  if (path.includes("..") || path.includes("\\") || path.startsWith("/")) {
    return false;
  }
  if (LEGACY_FLAT_SIGNER_ASSET.test(path)) {
    return signedBeforeProjectScoping(signedAt);
  }

  if (typeof projectId !== "string" || projectId.length === 0) return false;
  for (const folder of SCOPED_FOLDERS) {
    const prefix = `${folder}/${projectId}/`;
    if (
      path.startsWith(prefix) &&
      SCOPED_TAIL.test(path.slice(prefix.length))
    ) {
      return true;
    }
  }
  return false;
}
