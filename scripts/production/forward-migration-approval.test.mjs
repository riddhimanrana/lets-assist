import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { historicalReleaseTestFixture } from "./historical-release-test-fixture.mjs";
import { prepareMigration } from "./forward-migration-release.mjs";

test("unapproved migrations remain rejected beside the historical release fixture", () => {
  const future = historicalReleaseTestFixture();
  try {
    writeFileSync(
      resolve(
        future.cwd,
        "supabase/migrations/20990101000000_unapproved_test.sql",
      ),
      "SELECT 1;\n",
    );
    assert.throws(
      () => prepareMigration(future.cwd),
      /accepted migration tail is not approved/u,
    );
  } finally {
    future.dispose();
  }
});
