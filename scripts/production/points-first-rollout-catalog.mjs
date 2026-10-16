import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { migrationDigests } from "./migration-digests.mjs";
import { finalSchemaCatalog, ledgerDigest } from "./final-schema-manifest.mjs";
import { csfSubmissionDeletionCatalog } from "./csf-submission-deletion-catalog.mjs";
import { accountDeletionStorageCatalog } from "./account-deletion-storage-catalog.mjs";
import {
  publicImageHooksCatalog,
  publicImageStorageCatalog,
} from "./public-image-storage-catalog.mjs";
import { pausedSpeechDebateCatalog } from "./paused-speech-debate-catalog.mjs";
import { publishedEmbeddedBatch719Catalog } from "./published-embedded-batch-719-catalog.mjs";
import { publishedEmbedded721Catalog } from "./published-embedded-721-catalog.mjs";
import { publishedEmbedded731Catalog } from "./published-embedded-731-catalog.mjs";
import { publishedEmbedded732Catalog } from "./published-embedded-732-catalog.mjs";
import { projectStatusCronCatalog } from "./project-status-cron-catalog.mjs";
import {
  platformWorkflowAssetsCatalog,
  platformWorkflowCollationCatalog,
  platformWorkflowRepairCatalog,
} from "./platform-workflow-repair-catalog.mjs";

const planBytes = readFileSync(
  new URL("./points-first-688-to-739-catalog.json", import.meta.url),
);
const baselineBytes = readFileSync(
  new URL("./final-schema-points-first-688.json", import.meta.url),
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const reviewedPlanSha256 =
  "67abaa69fce9286e4db34e3fe82fd87af35fd8948a79ac93ef7e7de167521878";
const reviewedBaselineSha256 =
  "f834502758c31f4c0c8a4a4c11c2e29c8b7406322be0ea80144e2ce4636028be";
const reviewedTargetSha256 =
  "7789c4442aad99f6bedf91bda3cde33a9b0b49ac6b50690803c3d198bd8a89cb";
const fail = () => {
  throw new Error("The exact points-first rollout catalog was not verified.");
};
const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) freeze(item);
  }
  return value;
};

// The inputs are hash-pinned rehearsal metadata. A new file, version or catalog
// cannot become accepted merely by being present in the current checkout.
export function loadReviewedPointsFirstCatalog(
  input = planBytes,
  baselineInput = baselineBytes,
) {
  if (
    sha256(input) !== reviewedPlanSha256 ||
    sha256(baselineInput) !== reviewedBaselineSha256
  )
    fail();
  const plan = JSON.parse(input),
    baseline = JSON.parse(baselineInput);
  if (
    plan.format !== 1 ||
    plan.baseline.versions.length !== 688 ||
    plan.steps.length !== 51 ||
    plan.target.count !== 739 ||
    plan.baseline.manifestSha256 !== reviewedBaselineSha256 ||
    plan.target.manifestSha256 !== reviewedTargetSha256 ||
    plan.inventory !== baseline.inventory ||
    plan.baseline.ledger !== baseline.ledger ||
    ledgerDigest(plan.baseline.versions) !== baseline.ledger ||
    plan.steps[0].version !== "20260929051600" ||
    plan.baseline.versions.at(-1) !== "20261013071100"
  )
    fail();
  const versions = [...plan.baseline.versions],
    descriptors = [
      {
        index: 0,
        count: 688,
        ledger: baseline.ledger,
        manifestSha256: reviewedBaselineSha256,
        versions: [...versions],
      },
    ];
  for (const [index, step] of plan.steps.entries()) {
    if (
      !/^\d{14}$/u.test(step.version) ||
      !step.migration.startsWith(`${step.version}_`) ||
      !step.migration.endsWith(".sql") ||
      migrationDigests[step.migration] !== step.sha256 ||
      versions.includes(step.version) ||
      (index > 0 && step.version <= plan.steps[index - 1].version) ||
      step.count !== 689 + index ||
      !Array.isArray(step.changed) ||
      !Array.isArray(step.removed) ||
      step.removed.length !== 0 ||
      new Set(step.changed.map((row) => row.identity)).size !==
        step.changed.length ||
      step.changed.some(
        (row) =>
          typeof row.identity !== "string" ||
          !/^[a-f0-9]{32}$/u.test(row.digest),
      )
    )
      fail();
    versions.push(step.version);
    versions.sort();
    if (ledgerDigest(versions) !== step.ledger) fail();
    descriptors.push({
      index: index + 1,
      count: step.count,
      ledger: step.ledger,
      manifestSha256: step.manifestSha256,
      versions: [...versions],
    });
  }
  if (ledgerDigest(versions) !== plan.target.ledger) fail();
  const byLedger = new Map(descriptors.map((entry) => [entry.ledger, entry])),
    cache = new Map();
  if (byLedger.size !== 52) fail();
  freeze(descriptors);
  freeze(plan);

  const state = (observed) => {
    if (
      !Array.isArray(observed) ||
      observed.some((version) => typeof version !== "string")
    )
      return null;
    const descriptor = byLedger.get(ledgerDigest(observed));
    if (
      !descriptor ||
      JSON.stringify(observed) !== JSON.stringify(descriptor.versions)
    )
      return null;
    if (!cache.has(descriptor.index)) {
      const objects = new Map(
        baseline.objects.map((row) => [row.identity, row.digest]),
      );
      for (const step of plan.steps.slice(0, descriptor.index))
        for (const row of step.changed) objects.set(row.identity, row.digest);
      const manifest = {
        format: 1,
        ledger: descriptor.ledger,
        inventory: plan.inventory,
        objects: [...objects]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([identity, digest]) => ({ identity, digest })),
      };
      if (
        sha256(`${JSON.stringify(manifest, null, 2)}\n`) !==
        descriptor.manifestSha256
      )
        fail();
      cache.set(descriptor.index, freeze({ ...descriptor, manifest }));
    }
    return cache.get(descriptor.index);
  };
  return freeze({
    descriptors,
    steps: plan.steps,
    target: plan.target,
    state,
  });
}

const reviewed = loadReviewedPointsFirstCatalog();
export const pointsFirstRolloutStates = reviewed.descriptors;
export const pointsFirstRolloutMigrations = reviewed.steps;
export const pointsFirstRolloutTarget = reviewed.target;
export const pointsFirstRolloutState = reviewed.state;

export function pointsFirstRemainingMigrations(versions) {
  const state = pointsFirstRolloutState(versions);
  if (!state) fail();
  return pointsFirstRolloutMigrations.slice(state.index);
}

export function pointsFirstCatalogQuery(versions) {
  const state = pointsFirstRolloutState(versions);
  if (!state) return null;
  const applied = new Set(versions);
  let catalog = csfSubmissionDeletionCatalog(
    finalSchemaCatalog(state.manifest, versions),
  );
  if (applied.has("20261007040314"))
    catalog = accountDeletionStorageCatalog(catalog);
  if (applied.has("20261008040000"))
    catalog = publicImageStorageCatalog(catalog);
  else if (applied.has("20261008010000"))
    catalog = publicImageHooksCatalog(catalog);
  if (applied.has("20261009070000"))
    catalog = pausedSpeechDebateCatalog(catalog);
  if (applied.has("20261012002404"))
    catalog = publishedEmbedded732Catalog(catalog);
  else if (applied.has("20261011224034"))
    catalog = publishedEmbedded731Catalog(catalog);
  else if (applied.has("20261009080001"))
    catalog = publishedEmbedded721Catalog(catalog);
  else if (applied.has("20261009070001"))
    catalog = publishedEmbeddedBatch719Catalog(catalog);
  if (applied.has("20261009090000"))
    catalog = projectStatusCronCatalog(catalog);
  if (applied.has("20261011113000"))
    catalog = platformWorkflowRepairCatalog(catalog);
  else if (applied.has("20261011112500"))
    catalog = platformWorkflowAssetsCatalog(catalog);
  else if (applied.has("20261011110000"))
    catalog = platformWorkflowCollationCatalog(catalog);
  return catalog;
}
