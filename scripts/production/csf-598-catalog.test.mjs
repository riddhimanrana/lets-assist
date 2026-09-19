import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
import { approvedMigrations } from "./forward-migration-release.mjs";

const cwd = fileURLToPath(new URL("../../", import.meta.url));
const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const fullLedger = expectedVersions(cwd);
const ledger = fullLedger.slice(0, 598);

test("598 pins the reviewed preview append function and migration", () => {
  assert.equal(fullLedger.length, 612);
  assert.equal(ledger.length, 598);
  assert.equal(ledger.at(-1), "20260918180000");
  assert.ok(
    approvedMigrations.some(
      ([name]) => name === "20260918180000_csf_user_entered_sheet_fill_preview",
    ),
  );
  const previous = acceptedCatalogQuery(source, ledger.slice(0, 597));
  const current = acceptedCatalogQuery(source, ledger);
  assert.match(previous, /13e8ee1bc7b071f00664f808b2cf504a/u);
  assert.doesNotMatch(current, /13e8ee1bc7b071f00664f808b2cf504a/u);
  assert.match(current, /1e64a6a32f22099e11367757990182a0/u);
  assert.throws(
    () =>
      acceptedCatalogQuery(source, [...ledger.slice(0, 597), "20990101000000"]),
    /explicit release review/u,
  );
});
