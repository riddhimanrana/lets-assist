import { ReleaseCheckError } from "./app-release-checks.mjs";

const previousFingerprint = "f0aaa289ceda518c32ef0ea8468493ba";
const applicationSourceFingerprint = "05e5ea595dab2906d065d51c13748d3b";

// Migration 616 replaces only the officer connection evidence function. Keep
// every other accepted schema check unchanged.
export function csf616Catalog(previous) {
  if (previous.split(previousFingerprint).length !== 2)
    throw new ReleaseCheckError(
      "The reviewed CSF connection evidence predecessor changed.",
    );
  return previous.replace(previousFingerprint, applicationSourceFingerprint);
}
