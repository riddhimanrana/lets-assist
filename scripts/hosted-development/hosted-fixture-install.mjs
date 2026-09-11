import { readFileSync } from "node:fs";
import { isPluginVersionWithinContractRange } from "../../lib/plugins/sdk/v1/compatibility.ts";
import { FIXTURE_ORGANIZATION_ID } from "./csf-load-fixture.mjs";

const releases = JSON.parse(
  readFileSync(
    new URL("../../lib/plugins/published-releases.json", import.meta.url),
    "utf8",
  ),
);

export async function assertHostedFixtureInstall(publicDb) {
  const [install, access] = await Promise.all([
    publicDb
      .from("organization_plugin_installs")
      .select("enabled,installed_version,desired_version,configuration")
      .eq("organization_id", FIXTURE_ORGANIZATION_ID)
      .eq("plugin_key", "dvhs-csf")
      .maybeSingle(),
    publicDb
      .from("organization_plugin_access")
      .select("is_accessible,force_update_version")
      .eq("organization_id", FIXTURE_ORGANIZATION_ID)
      .eq("plugin_key", "dvhs-csf")
      .maybeSingle(),
  ]);
  const release = releases.find(
    (row) =>
      row.pluginKey === "dvhs-csf" &&
      row.runtimeProfile ===
        (install.data?.desired_version ? "application" : "embedded"),
  );
  const version = install.data?.installed_version;
  if (
    install.error ||
    access.error ||
    !install.data?.enabled ||
    !access.data?.is_accessible ||
    !version ||
    !release ||
    !isPluginVersionWithinContractRange(
      version,
      release.supportedInstallContracts,
    ) ||
    (access.data.force_update_version &&
      !isPluginVersionWithinContractRange(version, {
        minimum: access.data.force_update_version,
      }))
  ) {
    throw new Error(
      "Set up or update CSF for the hosted fixture through Organization access before provisioning. An enabled, accessible, compatible existing install is required; the fixture provisioner does not install or upgrade plugins.",
    );
  }
}
