import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { historicalReleaseTestFixture } from "./historical-release-test-fixture.mjs";
import {
  applyForwardMigrations,
  prepareMigration,
} from "./forward-migration-release.mjs";

test("unapproved migrations are refused before any provider request", async () => {
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
    let requests = 0;
    await assert.rejects(
      applyForwardMigrations(
        {
          cwd: future.cwd,
          projectRef: "fotdmeakexgrkronxlof",
          token: "synthetic-test-token",
        },
        async () => {
          requests += 1;
          throw new Error("Unexpected provider request");
        },
      ),
      /accepted migration tail is not approved/u,
    );
    assert.equal(requests, 0);
  } finally {
    future.dispose();
  }
});
