import { ReleaseCheckError } from "./app-release-checks.mjs";

const previousDigest = "7edc7ac2ff62c9f38e1f937c71505187";
const reviewedDigest = "a7a0680643c8c8a4f25ba969a3ff7459";

export function csf589Catalog(previous) {
  if (previous.split(previousDigest).length !== 2)
    throw new ReleaseCheckError(
      "The reviewed project schedule catalog predecessor changed.",
    );
  return previous.replace(previousDigest, reviewedDigest);
}
