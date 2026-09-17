import { ReleaseCheckError } from "./app-release-checks.mjs";

const previousDigest = "a7a0680643c8c8a4f25ba969a3ff7459";
const reviewedDigest = "afebeb55895133dc30e7cde6e9b3bac3";

export function csf590Catalog(previous) {
  if (previous.split(previousDigest).length !== 2)
    throw new ReleaseCheckError(
      "The reviewed nonempty project schedule catalog predecessor changed.",
    );
  return previous.replace(previousDigest, reviewedDigest);
}
