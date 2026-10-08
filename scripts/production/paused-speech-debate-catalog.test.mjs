import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { migrationDigests } from "./migration-digests.mjs";

const root = new URL("../../", import.meta.url).pathname;
const versions = expectedVersions(root).filter((v) => v <= "20261009070000");

test("the paused offering adds a catalog predicate without losing the measured schema", () => {
  assert.equal(versions.length, 718);
  const previous = acceptedCatalogQuery("", versions.slice(0, -1));
  const current = acceptedCatalogQuery("", versions);
  assert.ok(current.includes(previous.replace(/;\s*$/u, "")));
  assert.match(current, /key = 'dv-speech-debate'/u);
  assert.match(current, /NOT is_active/u);
  assert.match(current, /visibility = 'private'/u);
  assert.match(current, /force_update_version IS NULL/u);
});

test("an unreviewed ledger cannot inherit the paused offering acceptance", () => {
  assert.throws(
    () =>
      acceptedCatalogQuery("", [...versions.slice(0, -1), "20261009070001"]),
    /explicit release review/u,
  );
  assert.throws(
    () => acceptedCatalogQuery("", [...versions, "20261009080000"]),
    /explicit release review/u,
  );
});

test("the accepted pause migration matches the replayed bytes", () => {
  const filename = "20261009070000_pause_speech_debate_offering.sql";
  assert.equal(
    migrationDigests[filename],
    createHash("sha256")
      .update(
        readFileSync(
          new URL(`../../supabase/migrations/${filename}`, import.meta.url),
        ),
      )
      .digest("hex"),
  );
});
