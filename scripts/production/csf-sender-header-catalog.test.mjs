import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import { approvedMigrations } from "./forward-migration-release.mjs";
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const before = JSON.parse(read("./final-schema-634.json"));
const after = JSON.parse(read("./final-schema-635.json"));
const ledger = expectedVersions(
  new URL("../../", import.meta.url).pathname,
).slice(0, 635);
const prior = new Map(before.objects.map((row) => [row.identity, row.digest]));

test("635 changes only the canonical notification provider request", () => {
  assert.equal(ledger.at(-1), "20260920233200");
  assert.equal(
    acceptedCatalogQuery("", ledger),
    finalSchemaCatalog(after, ledger),
  );
  assert.equal(after.inventory, before.inventory);
  assert.deepEqual(
    after.objects.map((row) => row.identity),
    before.objects.map((row) => row.identity),
  );
  assert.deepEqual(
    after.objects
      .filter((row) => prior.get(row.identity) !== row.digest)
      .map((row) => row.identity.split("(")[0]),
    ["function:plugin_data.csf_communication_provider_request"],
  );
});

test("the byte-pinned sender change preserves earlier sender formats", () => {
  const name = "20260920233200_csf_organization_sender_header";
  const sql = read(`../../supabase/migrations/${name}.sql`);
  assert.deepEqual(
    approvedMigrations.find(([entry]) => entry === name),
    [name, createHash("sha256").update(sql).digest("hex")],
  );
  assert.match(
    sql,
    /CASE WHEN v_campaign\.sender_email = 'updates@notifications\.lets-assist\.com'/u,
  );
  assert.match(
    sql,
    /THEN to_jsonb\(coalesce\(v_campaign\.sender_name, ''\)\)::text/u,
  );
  assert.match(sql, /ELSE coalesce\(v_campaign\.sender_name, ''\) END/u);
  assert.doesNotMatch(
    sql,
    /(?:UPDATE|DELETE FROM) plugin_data\.csf_communication_campaigns/u,
  );
});
