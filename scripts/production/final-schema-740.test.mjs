import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
import { ledgerDigest } from "./final-schema-manifest.mjs";
import { maintenanceTarget } from "./maintenance-preflight.mjs";
import {
  loadReviewedPointsFirstCatalog,
  pointsFirstRolloutState,
} from "./points-first-rollout-catalog.mjs";

const read = (name) => readFileSync(new URL(name, import.meta.url));
const previous = JSON.parse(read("./final-schema-739.json"));
const currentBytes = read("./final-schema-740.json");
const current = JSON.parse(currentBytes);
const deltaBytes = read("./project-calendar-deletion-740-catalog.json");
const delta = JSON.parse(deltaBytes);
const versions = expectedVersions(new URL("../../", import.meta.url).pathname);

test("740 accepts only the exact calendar fence ledger and catalog delta", () => {
  assert.equal(versions.length, 740);
  assert.equal(versions.at(-1), "20261020031605");
  assert.equal(current.ledger, ledgerDigest(versions));
  assert.deepEqual(maintenanceTarget(process.cwd()), versions);
  assert.equal(current.inventory, previous.inventory);
  const before = new Map(
    previous.objects.map((row) => [row.identity, row.digest]),
  );
  const after = new Map(
    current.objects.map((row) => [row.identity, row.digest]),
  );
  assert.equal(after.size, before.size + 1);
  assert.deepEqual(
    [...before.keys()].filter((key) => !after.has(key)),
    [],
  );
  assert.deepEqual(
    current.objects.filter((row) => before.get(row.identity) !== row.digest),
    delta.step.changed,
  );
  assert.equal(delta.step.changed.length, 5);
  assert.deepEqual(delta.step.removed, []);
  assert.equal(
    createHash("sha256").update(currentBytes).digest("hex"),
    delta.target.manifestSha256,
  );
  assert.deepEqual(pointsFirstRolloutState(versions).manifest, current);
  const sql = acceptedCatalogQuery("untrusted predecessor", versions);
  for (const name of [
    "project_calendar_deletion_pending",
    "project_asset_object_delete_guard",
    "process-project-statuses",
    "csf_target_schema_verified",
  ])
    assert.ok(sql.includes(name), name);
  assert.ok(!sql.includes("untrusted predecessor"));
});

test("an altered extension cannot register a future or changed catalog", () => {
  const altered = JSON.parse(deltaBytes);
  altered.step.changed[0].digest = "0".repeat(32);
  assert.throws(() =>
    loadReviewedPointsFirstCatalog(
      read("./points-first-688-to-739-catalog.json"),
      read("./final-schema-points-first-688.json"),
      Buffer.from(JSON.stringify(altered)),
    ),
  );
  assert.throws(() =>
    acceptedCatalogQuery("", [...versions, "20990101000000"]),
  );
});
