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
const FLAT_SIGNER_ASSET =
  /^waiver_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[A-Za-z0-9_-]{1,64}_\d{10,16}\.(?:png|jpe?g)$/u;

const SCOPED_FOLDERS = [
  "signatures",
  "signed-waivers",
  "cloned-waiver-evidence",
] as const;

const SCOPED_TAIL =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$/u;

export function isProjectWaiverEvidencePath(
  path: string | null | undefined,
  projectId: string | null | undefined,
): path is string {
  if (typeof path !== "string" || path.length === 0 || path.length > 300) {
    return false;
  }
  if (path.includes("..") || path.includes("\\") || path.startsWith("/")) {
    return false;
  }
  // The signer image name carries a random evidence key and no folder.
  if (FLAT_SIGNER_ASSET.test(path)) return true;

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
