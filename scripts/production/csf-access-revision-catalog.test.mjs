import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import { approvedMigrations } from "./forward-migration-release.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const before = JSON.parse(read("./final-schema-633.json"));
const after = JSON.parse(read("./final-schema-634.json"));
const ledger = expectedVersions(
  new URL("../../", import.meta.url).pathname,
).slice(0, 634);
const prior = new Map(before.objects.map((row) => [row.identity, row.digest]));
const short = (row) => row.identity.split("(")[0];

test("634 binds organization access notices to a protected revision", () => {
  assert.equal(ledger.at(-1), "20260920233100");
  assert.equal(
    acceptedCatalogQuery("", ledger),
    finalSchemaCatalog(after, ledger),
  );
  assert.equal(after.inventory, before.inventory);
  assert.deepEqual(
    after.objects.filter((row) => !prior.has(row.identity)).map(short),
    ["function:plugin_data.csf_stamp_organization_access_revision"],
  );
  assert.deepEqual(
    after.objects
      .filter(
        (row) =>
          prior.has(row.identity) && prior.get(row.identity) !== row.digest,
      )
      .map(short),
    [
      "function:plugin_data.csf_transition_notice_fingerprint",
      "relation:public.organization_members",
    ],
  );
  assert.ok(
    before.objects.every((row) =>
      after.objects.some((next) => next.identity === row.identity),
    ),
  );
});

test("the access revision migration is byte-pinned and keeps the trigger internal", () => {
  const name = "20260920233100_csf_organization_access_notice_revision";
  const sql = read(`../../supabase/migrations/${name}.sql`);
  assert.deepEqual(
    approvedMigrations.find(([entry]) => entry === name),
    [name, createHash("sha256").update(sql).digest("hex")],
  );
  assert.match(sql, /BEFORE INSERT OR UPDATE ON public\.organization_members/u);
  assert.match(sql, /NEW\.access_revision := OLD\.access_revision/u);
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION plugin_data\.csf_stamp_organization_access_revision\(\) FROM PUBLIC,anon,authenticated,service_role/u,
  );
});
