import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  finalSchemaCatalog,
  finalSchemaInventory,
} from "./final-schema-manifest.mjs";
import { generateFinalSchemaManifest } from "./generate-final-schema-manifest.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
const manifest = JSON.parse(
  readFileSync(new URL("./final-schema-623.json", import.meta.url), "utf8"),
);
const versions = expectedVersions(
  new URL("../../", import.meta.url).pathname,
).slice(0, 623);

test("623 selects the final catalog without consulting predecessor SQL", () => {
  assert.equal(
    acceptedCatalogQuery("invalid predecessor SQL", versions),
    finalSchemaCatalog(manifest, versions),
  );
});
test("inventory generation is repeatable and insensitive to incoming row order", () => {
  assert.deepEqual(
    generateFinalSchemaManifest(versions, [...manifest.objects].reverse()),
    manifest,
  );
});
test("unreviewed ledgers, changed inventory contracts and duplicate keys fail closed", () => {
  assert.throws(() =>
    finalSchemaCatalog(manifest, [...versions, "20990101000000"]),
  );
  assert.throws(() =>
    finalSchemaCatalog({ ...manifest, inventory: "0".repeat(64) }, versions),
  );
  assert.throws(() =>
    finalSchemaCatalog(
      { ...manifest, objects: [...manifest.objects, manifest.objects[0]] },
      versions,
    ),
  );
});
test("comparison rejects extra, missing and changed objects and keeps data gates", () => {
  const sql = finalSchemaCatalog(manifest, versions);
  assert.match(sql, /FULL JOIN expected/);
  assert.match(sql, /actual.digest IS DISTINCT FROM expected.digest/);
  assert.match(sql, /csf_retention_retired_cohorts/);
  assert.match(sql, /csf_retention_reference_policy/);
  assert.ok(
    manifest.objects.some((row) =>
      row.identity.startsWith("function:plugin_data.csf_delete_activity("),
    ),
  );
  assert.ok(
    manifest.objects.some(
      (row) => row.identity === "cron:retain-cron-execution-history",
    ),
  );
});
test("inventory binds definitions, ACLs, owner, search paths, RLS and complete policies", () => {
  for (const marker of [
    "pg_get_functiondef",
    "proacl",
    "pg_get_userbyid",
    "relrowsecurity",
    "relforcerowsecurity",
    "attacl",
    "polroles",
    "polqual",
    "polwithcheck",
    "pg_get_triggerdef",
    "indisvalid",
    "convalidated",
    "command",
    "schedule",
  ])
    assert.ok(finalSchemaInventory.includes(marker), marker);
  assert.doesNotMatch(finalSchemaInventory, /FROM (?:plugin_data|public)\./);
});

test("inventory includes delegated private functions and canonical permission metadata", () => {
  assert.ok(
    manifest.objects.some((row) =>
      row.identity.startsWith("function:private."),
    ),
  );
  assert.ok(
    manifest.objects.some((row) =>
      row.identity.startsWith("default-acl:postgres:"),
    ),
  );
  assert.match(finalSchemaInventory, /pg_catalog\.aclexplode\(NULLIF\(/);
  assert.match(finalSchemaInventory, /x\.privilege_type,x\.is_grantable/);
  assert.match(finalSchemaInventory, /entry\.value::text COLLATE "C"/);
  assert.match(
    finalSchemaInventory,
    /role_name ORDER BY role_name COLLATE "C"/,
  );
  assert.doesNotMatch(
    finalSchemaInventory,
    /(?:proacl|relacl|attacl|nspacl|typacl)::text/,
  );
  assert.doesNotMatch(finalSchemaInventory, /END ORDER BY r\)/);
  for (const key of [
    "seqstart",
    "seqincrement",
    "seqmin",
    "seqmax",
    "seqcache",
    "seqcycle",
  ])
    assert.ok(finalSchemaInventory.includes(key), key);
});
