import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isolatedReleaseCatalogQuery,
  localFixtureFunctions,
} from "./isolated-release-catalog.mjs";

test("isolated catalog teardown matches only the configured seed helpers", () => {
  const seed = readFileSync(
    new URL("../../supabase/seeds/local-only.sql", import.meta.url),
    "utf8",
  );
  const names = [
    ...seed.matchAll(/CREATE OR REPLACE FUNCTION plugin_data\.(\w+)\(/gu),
  ]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(
    localFixtureFunctions.map((signature) => signature.split("(")[0]).sort(),
    names,
  );
});

test("the catalog runs inside a bounded transaction that restores the helpers", () => {
  const catalog = "SELECT 1 AS csf_target_schema_verified;";
  const sql = isolatedReleaseCatalogQuery(catalog);
  assert.ok(sql.startsWith("BEGIN;\n"));
  assert.ok(sql.endsWith(`${catalog}\nROLLBACK;`));
  assert.match(sql, /SET LOCAL lock_timeout = '5s';/u);
  assert.match(sql, /SET LOCAL statement_timeout = '30s';/u);
  assert.equal((sql.match(/DROP FUNCTION IF EXISTS/gu) ?? []).length, 7);
  assert.doesNotMatch(sql, /CASCADE|COMMIT|DROP (?:TABLE|SCHEMA)/u);
  for (const path of [
    "./app-release-checks.mjs",
    "./forward-migration-release.mjs",
  ])
    assert.doesNotMatch(
      readFileSync(new URL(path, import.meta.url), "utf8"),
      /isolated-release-catalog/u,
    );
});
