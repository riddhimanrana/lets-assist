import { ReleaseCheckError } from "./app-release-checks.mjs";

const previousDigest = "3e555109b43f9bee6d0b36dc2e0671fe";
const reviewedDigest = "330c00eddb988e4d5d9d19bca0b61f9d";

export function csf593Catalog(previous) {
  if (previous.split(previousDigest).length !== 2)
    throw new ReleaseCheckError(
      "The reviewed meeting-window authority catalog predecessor changed.",
    );
  return previous.replace(previousDigest, reviewedDigest);
}
