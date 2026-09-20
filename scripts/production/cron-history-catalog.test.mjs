import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
import { approvedMigrations } from "./forward-migration-release.mjs";

const cwd = fileURLToPath(new URL("../../", import.meta.url));
const name = "20260920010000_bound_cron_execution_history";
const sql = readFileSync(`${cwd}/supabase/migrations/${name}.sql`, "utf8");
const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const ledger = expectedVersions(cwd).slice(0, 622);

test("the release pins the exact retention command, owner and schedule", () => {
  assert.equal(ledger.at(-1), "20260920010000");
  assert.deepEqual(
    approvedMigrations.find(([entry]) => entry === name),
    [name, createHash("sha256").update(sql).digest("hex")],
  );
  const catalog = acceptedCatalogQuery(source, ledger);
  assert.ok(
    catalog.includes(
      createHash("md5").update(sql.split("$job$")[1]).digest("hex"),
    ),
  );
  assert.match(catalog, /username = 'postgres'/);
  assert.match(catalog, /schedule = '17 \* \* \* \*'/);
  assert.match(catalog, /AS csf_target_schema_verified;$/);
  assert.throws(
    () =>
      acceptedCatalogQuery(source, [...ledger.slice(0, -1), "20990101000000"]),
    /explicit release review/,
  );
});
