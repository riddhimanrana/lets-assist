import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { selectMaintenanceLedger } from "./maintenance-preflight.mjs";
import {
  loadReviewedPointsFirstCatalog,
  pointsFirstRemainingMigrations,
  pointsFirstCatalogQuery,
  pointsFirstRolloutMigrations,
  pointsFirstRolloutState,
  pointsFirstRolloutStates,
} from "./points-first-rollout-catalog.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const plan = readFileSync(
  new URL("./points-first-688-to-739-catalog.json", import.meta.url),
);
const baseline = readFileSync(
  new URL("./final-schema-points-first-688.json", import.meta.url),
);

test("every committed points-first state reconstructs its captured catalog", () => {
  assert.equal(pointsFirstRolloutStates.length, 52);
  for (const descriptor of pointsFirstRolloutStates) {
    const state = pointsFirstRolloutState(descriptor.versions);
    assert.equal(state.count, descriptor.count);
    assert.equal(
      sha256(`${JSON.stringify(state.manifest, null, 2)}\n`),
      descriptor.manifestSha256,
    );
  }
  const target = pointsFirstRolloutState(
    pointsFirstRolloutStates.at(-1).versions,
  );
  assert.equal(
    sha256(`${JSON.stringify(target.manifest, null, 2)}\n`),
    sha256(readFileSync(new URL("./final-schema-739.json", import.meta.url))),
  );
});

test("735 through 738 are explicit committed recovery states", () => {
  for (const count of [735, 736, 737, 738]) {
    const descriptor = pointsFirstRolloutStates.find(
      (state) => state.count === count,
    );
    assert.ok(descriptor);
    assert.equal(pointsFirstRolloutState(descriptor.versions).count, count);
  }
});

test("maintenance accepts known states only for the exact target and mode", () => {
  const target = pointsFirstRolloutStates.at(-1).versions;
  for (const state of pointsFirstRolloutStates) {
    assert.deepEqual(
      selectMaintenanceLedger(target, state.versions, "before"),
      state.versions,
    );
    if (state.count < 739)
      assert.throws(() =>
        selectMaintenanceLedger(target, state.versions, "target"),
      );
  }
  assert.deepEqual(selectMaintenanceLedger(target, target, "target"), target);
  assert.throws(() =>
    selectMaintenanceLedger(
      [...target, "20990101000000"],
      pointsFirstRolloutStates[0].versions,
      "before",
    ),
  );
});

test("partial stages retain their applicable Storage and data guards", () => {
  const query = (count) =>
    pointsFirstCatalogQuery(
      pointsFirstRolloutStates.find((state) => state.count === count).versions,
    );
  for (const state of pointsFirstRolloutStates) {
    const sql = pointsFirstCatalogQuery(state.versions);
    assert.match(sql, /FULL JOIN expected/u);
    assert.match(sql, /csf_retention_retired_cohorts/u);
    assert.match(sql, /csf_retention_reference_policy/u);
    assert.match(sql, /csf_fence_deleted_submission_storage_upload/u);
  }
  assert.doesNotMatch(query(691), /account_deletion_storage_reference_fence/u);
  assert.match(query(692), /account_deletion_storage_reference_fence/u);
  assert.match(query(706), /public_image_auth_reference/u);
  assert.equal(
    query(706).includes("FROM app_private.storage_object_policy_contract c)"),
    false,
    "the final policy-contract predicate is not applied before its migration",
  );
  assert.match(query(709), /storage_object_policy_contract_violations/u);
  assert.match(query(728), /csf_review_name_order/u);
  assert.doesNotMatch(query(728), /project_asset_object_delete_guard/u);
  assert.match(query(730), /project_asset_object_delete_guard/u);
  assert.doesNotMatch(query(730), /waiver_source_object_immutable/u);
  assert.match(query(731), /waiver_source_object_immutable/u);
});

test("only the exact remaining migration bytes belong to each state", () => {
  const before = pointsFirstRolloutStates[0];
  assert.equal(pointsFirstRemainingMigrations(before.versions).length, 51);
  assert.equal(
    pointsFirstRemainingMigrations(before.versions)[0].version,
    "20260929051600",
  );
  assert.ok(
    pointsFirstRolloutMigrations.every(
      (step) => step.version !== "20261013071100",
    ),
  );
  const joined = pointsFirstRolloutStates.find((state) => state.count === 734);
  assert.equal(pointsFirstRemainingMigrations(joined.versions).length, 5);
  assert.deepEqual(
    pointsFirstRemainingMigrations(pointsFirstRolloutStates.at(-1).versions),
    [],
  );
});

test("unknown, reordered, duplicate and fence-first histories stay refused", () => {
  const versions = pointsFirstRolloutStates[0].versions;
  const invalid = [
    null,
    [],
    versions.slice(1),
    [...versions].reverse(),
    [...versions.slice(0, -1), versions[0]],
    [...versions, "20990101000000"],
    [...versions.slice(0, -1), "20260929051600"],
  ];
  for (const value of invalid) {
    assert.equal(pointsFirstRolloutState(value), null);
    assert.throws(() => pointsFirstRemainingMigrations(value));
  }
});

test("changed plan or baseline bytes cannot acquire catalog approval", () => {
  assert.throws(() =>
    loadReviewedPointsFirstCatalog(Buffer.concat([plan, Buffer.from(" ")])),
  );
  assert.throws(() =>
    loadReviewedPointsFirstCatalog(
      plan,
      Buffer.concat([baseline, Buffer.from(" ")]),
    ),
  );
  const changed = JSON.parse(plan);
  changed.steps[0].sha256 = "0".repeat(64);
  assert.throws(() => loadReviewedPointsFirstCatalog(JSON.stringify(changed)));
});

test("returned source identities and catalog metadata are immutable", () => {
  const state = pointsFirstRolloutState(pointsFirstRolloutStates[0].versions);
  assert.throws(() => state.versions.push("20990101000000"));
  assert.throws(() => {
    state.manifest.objects[0].digest = "0".repeat(32);
  });
  assert.throws(() => {
    pointsFirstRolloutMigrations[0].sha256 = "0".repeat(64);
  });
});
