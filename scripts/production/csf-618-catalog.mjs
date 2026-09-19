import { ReleaseCheckError } from "./app-release-checks.mjs";

const previousFingerprint = "05e5ea595dab2906d065d51c13748d3b";
const advisoryOnlyFingerprint = "a2f8a113c912822dc87be42ada252d5d";

// Migration 618 removes application-response contact addresses from connection
// authority while retaining them as officer-visible discovery evidence.
export function csf618Catalog(previous) {
  if (previous.split(previousFingerprint).length !== 2)
    throw new ReleaseCheckError(
      "The reviewed CSF application-contact predecessor changed.",
    );
  return previous.replace(previousFingerprint, advisoryOnlyFingerprint);
}
