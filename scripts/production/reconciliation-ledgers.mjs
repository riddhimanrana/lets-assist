// The two already-reviewed histories meet in PR #873's Development merge.
// Keep their exact versions distinct so their prior catalog evidence remains
// testable after forward migrations extend the combined ledger.
export const candidateOnlyVersions = [
  "20261011104000",
  "20261011105000",
  "20261011105500",
  "20261011110000",
  "20261011112000",
  "20261011112500",
  "20261011113000",
  "20261011224034",
  "20261012002404",
];

export const developmentOnlyVersions = [
  "20261013010957",
  "20261013071100",
  "20261014050438",
  "20261014060423",
  "20261014142100",
  "20261014162331",
];

const without = (versions, excluded) => {
  const excludedSet = new Set(excluded);
  return versions.filter((version) => !excludedSet.has(version));
};

export const reviewedCandidateVersions = (combined) =>
  without(combined, developmentOnlyVersions);

export const reviewedDevelopmentVersions = (combined) =>
  without(combined, candidateOnlyVersions);
