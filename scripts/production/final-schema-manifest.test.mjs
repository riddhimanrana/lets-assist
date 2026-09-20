import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  finalSchemaCatalog,
  finalSchemaInventory,
} from "./final-schema-manifest.mjs";
import {
  assertCleanInventory,
  generateFinalSchemaManifest,
} from "./generate-final-schema-manifest.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
const manifest = JSON.parse(
  readFileSync(new URL("./final-schema-625.json", import.meta.url), "utf8"),
);
const versions = expectedVersions(
  new URL("../../", import.meta.url).pathname,
).slice(0, 625);

test("625 selects the final catalog without consulting predecessor SQL", () => {
  assert.equal(
    acceptedCatalogQuery("invalid predecessor SQL", versions),
    finalSchemaCatalog(manifest, versions),
  );
});
test("626 removes hosted policy drift without changing the reviewed clean schema", () => {
  const next = JSON.parse(
    readFileSync(new URL("./final-schema-626.json", import.meta.url), "utf8"),
  );
  const nextVersions = [...versions, "20260920042000"];
  assert.deepEqual(next.objects, manifest.objects);
  assert.equal(
    acceptedCatalogQuery("invalid predecessor SQL", nextVersions),
    finalSchemaCatalog(next, nextVersions),
  );
  assert.throws(() => finalSchemaCatalog(next, versions));
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

test("provider defaults stay outside the repository boundary and fixture capture fails closed", () => {
  assert.ok(
    manifest.objects.every(
      (row) => !row.identity.startsWith("default-acl:supabase_admin:"),
    ),
  );
  assert.match(
    finalSchemaInventory,
    /WHERE pg_catalog.pg_get_userbyid\(d.defaclrole\) IN \('postgres','service_role','authenticated','anon'\)/,
  );
  assert.match(finalSchemaInventory, /coalesce\(c.relacl/);
  assert.throws(
    () =>
      assertCleanInventory([
        {
          identity:
            "function:plugin_data.csf_assert_fixture_keys(p_scope text)",
        },
      ]),
    /fixture helpers/,
  );
  assert.doesNotThrow(() =>
    assertCleanInventory([
      {
        identity: "function:plugin_data.csf_actor_can_manage_staff(uuid,uuid)",
      },
    ]),
  );
});

test("627 publishes the signed UI patch with the unchanged 626 schema inventory", () => {
  const before = JSON.parse(
    readFileSync(new URL("./final-schema-626.json", import.meta.url), "utf8"),
  );
  const after = JSON.parse(
    readFileSync(new URL("./final-schema-627.json", import.meta.url), "utf8"),
  );
  const ledger = expectedVersions(
    new URL("../../", import.meta.url).pathname,
  ).slice(0, 627);
  assert.equal(ledger.at(-1), "20260920062528");
  assert.deepEqual(after.objects, before.objects);
  assert.equal(after.inventory, before.inventory);
  assert.equal(
    acceptedCatalogQuery("invalid predecessor SQL", ledger),
    finalSchemaCatalog(after, ledger),
  );
  assert.throws(() => finalSchemaCatalog(after, ledger.slice(0, 626)));
});

test("628 changes only the reviewed attendance commit fast path", () => {
  const before = JSON.parse(
    readFileSync(new URL("./final-schema-627.json", import.meta.url), "utf8"),
  );
  const after = JSON.parse(
    readFileSync(new URL("./final-schema-628.json", import.meta.url), "utf8"),
  );
  const ledger = expectedVersions(
    new URL("../../", import.meta.url).pathname,
  ).slice(0, 628);
  assert.equal(ledger.at(-1), "20260920080000");
  assert.deepEqual(
    after.objects.map((row) => row.identity),
    before.objects.map((row) => row.identity),
  );
  const previous = new Map(
    before.objects.map((row) => [row.identity, row.digest]),
  );
  assert.deepEqual(
    after.objects
      .filter((row) => previous.get(row.identity) !== row.digest)
      .map((row) => row.identity),
    [
      "function:plugin_data.csf_commit_meeting_attendance_import_identity_base(p_organization_id uuid, p_preview_job_id uuid, p_actor_user_id uuid, p_reason text, p_correlation_id uuid, p_evidence_token uuid, p_allow_unresolved boolean)",
    ],
  );
  assert.equal(after.inventory, before.inventory);
  assert.equal(
    acceptedCatalogQuery("invalid predecessor SQL", ledger),
    finalSchemaCatalog(after, ledger),
  );
  assert.throws(() => finalSchemaCatalog(after, ledger.slice(0, 627)));
});

test("persisted race-test helpers cannot enter a release manifest", () => {
  for (const identity of [
    "function:plugin_data.csf_test_begin_then_commit_race()",
    "function:plugin_data.csf_test_capture_import_merge_race(p_operation text)",
  ]) {
    assert.throws(
      () => assertCleanInventory([{ identity }]),
      /fixture helpers/,
    );
  }
});
