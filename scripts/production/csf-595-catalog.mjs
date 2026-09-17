import { ReleaseCheckError } from "./app-release-checks.mjs";

const directoryDefinitions = [
  ["69a3d086915e57c9871ed3fa1cec1893", "f752072b3c9f08c4e58b8ceb4a0bdbba"],
  ["e37e17e30c806043c4c85585a571a106", "491ddbf3a3b7351fd5753ad974f5caaf"],
];

export function csf595Catalog(previous) {
  let reviewed = previous;
  for (const [before, after] of directoryDefinitions) {
    if (reviewed.split(before).length !== 2)
      throw new ReleaseCheckError(
        "The reviewed retired-class directory catalog predecessor changed.",
      );
    reviewed = reviewed.replace(before, after);
  }
  return reviewed;
}
