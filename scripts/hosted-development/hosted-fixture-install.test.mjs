import { test } from "node:test";
import assert from "node:assert/strict";
import { assertHostedFixtureInstall } from "./hosted-fixture-install.mjs";
import { FIXTURE_ORGANIZATION_ID } from "./csf-load-fixture.mjs";

function database(install, access = { is_accessible: true }) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      const query = {
        select() {
          return query;
        },
        eq(key, value) {
          assert.equal(
            value,
            key === "organization_id" ? FIXTURE_ORGANIZATION_ID : "dvhs-csf",
          );
          return query;
        },
        async maybeSingle() {
          return {
            data: table === "organization_plugin_installs" ? install : access,
          };
        },
      };
      return query;
    },
  };
}

test("hosted setup preserves the compatible existing install without writes", async () => {
  const install = {
    enabled: true,
    installed_version: "1.1.0",
    desired_version: null,
    configuration: { preserved: true },
  };
  const before = structuredClone(install);
  const db = database(install);
  await assertHostedFixtureInstall(db);
  assert.deepEqual(install, before);
  assert.deepEqual(db.calls, [
    "organization_plugin_installs",
    "organization_plugin_access",
  ]);
});

test("missing, disabled, inaccessible and incompatible installs need normal setup", async () => {
  for (const install of [
    null,
    { enabled: false, installed_version: "1.1.0" },
    { enabled: true, installed_version: "0.9.0" },
    { enabled: true, installed_version: "9.0.0" },
  ])
    await assert.rejects(
      assertHostedFixtureInstall(database(install)),
      /Organization access/,
    );
  await assert.rejects(
    assertHostedFixtureInstall(
      database(
        { enabled: true, installed_version: "1.1.0" },
        { is_accessible: false },
      ),
    ),
    /Organization access/,
  );
  await assert.rejects(
    assertHostedFixtureInstall(
      database(
        { enabled: true, installed_version: "1.1.0" },
        { is_accessible: true, force_update_version: "1.2.0" },
      ),
    ),
    /Organization access/,
  );
});
