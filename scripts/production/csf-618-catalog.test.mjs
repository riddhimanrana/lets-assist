import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
import { approvedMigrations } from "./forward-migration-release.mjs";

const cwd = fileURLToPath(new URL("../../", import.meta.url));
const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const ledger = expectedVersions(cwd);
const migrationName =
  "20260919210000_csf_application_source_email_advisory_only";
const migration = readFileSync(
  new URL(`../../supabase/migrations/${migrationName}.sql`, import.meta.url),
  "utf8",
);

test("618 keeps application contacts advisory-only for record connections", () => {
  assert.equal(ledger.length, 618);
  assert.equal(ledger.at(-1), "20260919210000");
  assert.deepEqual(approvedMigrations.at(-1), [
    migrationName,
    createHash("sha256").update(migration).digest("hex"),
  ]);

  const previous = acceptedCatalogQuery(source, ledger.slice(0, 617));
  const current = acceptedCatalogQuery(source, ledger);
  assert.match(previous, /05e5ea595dab2906d065d51c13748d3b/u);
  assert.doesNotMatch(current, /05e5ea595dab2906d065d51c13748d3b/u);
  assert.match(current, /a2f8a113c912822dc87be42ada252d5d/u);
  assert.equal(current.length, previous.length);
});

test("618 refuses an unreviewed ledger", () => {
  assert.throws(
    () =>
      acceptedCatalogQuery(source, [...ledger.slice(0, -1), "20990101000000"]),
    /explicit release review/u,
  );
});
