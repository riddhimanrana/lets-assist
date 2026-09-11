import { readFileSync } from "node:fs";
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

test("application fixtures require the checkout release and its selected healthy Development deployment", async () => {
  const version = JSON.parse(
    readFileSync(
      new URL("../../lib/plugins/published-releases.json", import.meta.url),
      "utf8",
    ),
  ).find(
    (row) =>
      row.pluginKey === "dvhs-csf" && row.runtimeProfile === "application",
  ).version;
  const install = {
    enabled: true,
    installed_version: "1.1.0",
    desired_version: version,
  };
  const healthy = {
    pluginKey: "dvhs-csf",
    environment: "development",
    installEnabled: true,
    pluginAccessible: true,
    installedVersion: "1.1.0",
    desiredVersion: version,
    selectedApplicationVersion: version,
    applicationEnabled: true,
    selectedDeploymentHealthy: true,
    selectedDeploymentId: "fixture-deployment",
  };
  for (const patch of [
    null,
    { selectedApplicationVersion: "1.0.0" },
    { selectedDeploymentHealthy: false },
    { selectedDeploymentId: null },
    { applicationEnabled: false },
    { environment: "production" },
    { desiredVersion: null },
    { installEnabled: false },
  ]) {
    const db = database(install);
    db.rpc = async (name, args) => {
      assert.equal(name, "get_plugin_application_runtime_admin_status");
      assert.deepEqual(args, {
        p_organization_id: FIXTURE_ORGANIZATION_ID,
        p_plugin_key: "dvhs-csf",
        p_environment: "development",
      });
      return { data: { ...healthy, ...patch } };
    };
    if (patch === null) await assertHostedFixtureInstall(db);
    else
      await assert.rejects(
        assertHostedFixtureInstall(db),
        /healthy Development deployment/,
      );
  }
  await assert.rejects(
    assertHostedFixtureInstall(
      database({ ...install, desired_version: "1.0.0" }),
    ),
    /checkout's signed/,
  );
  const failed = database(install);
  failed.rpc = async () => ({
    data: healthy,
    error: { message: "unavailable" },
  });
  await assert.rejects(
    assertHostedFixtureInstall(failed),
    /healthy Development deployment/,
  );
});
