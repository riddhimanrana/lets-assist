import { ReleaseCheckError } from "./app-release-checks.mjs";

const changedDefinitions = [
  ["61b3229cfbf62af18b217ac5e3255e64", "a6bfc7c31331671e7c7c90c918bbeb03"],
  ["f5b74163ac45204dc9249017e4aadd9e", "09e04b85d2aab1ca62c0497c53a919d3"],
];

export function csf597Catalog(previous) {
  let reviewed = previous;
  for (const [before, after] of changedDefinitions) {
    if (reviewed.split(before).length !== 2)
      throw new ReleaseCheckError(
        "The reviewed retired-class terminal guard predecessor changed.",
      );
    reviewed = reviewed.replace(before, after);
  }
  return reviewed;
}
