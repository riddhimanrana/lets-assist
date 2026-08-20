import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import { publishedPluginReleases } from "@/lib/plugins/published-releases";
import {
  coalescePluginVersion,
  isPluginVersionBehind,
  isPluginVersionWithinContractRange,
} from "@/lib/plugins/versioning";

type PluginInstallAccessRow = {
  enabled: boolean;
  installed_version: string | null;
};

type PluginRuntimeAccessRow = {
  is_accessible: boolean;
  entitlement_is_forced: boolean;
  latest_version: string;
  force_update_version: string | null;
};

/**
 * Fail-closed control-plane gate for server-only plugin data access.
 *
 * Service-role plugin backends bypass RLS by design, so every externally
 * reachable server entrypoint must verify the real install row and the
 * consolidated catalog/entitlement access model before touching plugin data.
 */
export async function hasOrganizationPluginRuntimeAccess(input: {
  organizationId: string;
  pluginKey: string;
}): Promise<boolean> {
  const service = getAdminClient();
  const [installResult, accessResult] = await Promise.all([
    service
      .from("organization_plugin_installs")
      .select("enabled, installed_version")
      .eq("organization_id", input.organizationId)
      .eq("plugin_key", input.pluginKey)
      .maybeSingle(),
    service
      .from("organization_plugin_access")
      .select(
        "is_accessible, entitlement_is_forced, latest_version, force_update_version",
      )
      .eq("organization_id", input.organizationId)
      .eq("plugin_key", input.pluginKey)
      .maybeSingle(),
  ]);

  if (installResult.error) {
    throw new Error(
      `Failed to verify plugin install access: ${installResult.error.message}`,
    );
  }
  if (accessResult.error) {
    throw new Error(
      `Failed to verify plugin entitlement access: ${accessResult.error.message}`,
    );
  }

  const install = installResult.data as PluginInstallAccessRow | null;
  const access = accessResult.data as PluginRuntimeAccessRow | null;
  const loadedRelease = publishedPluginReleases.find(
    (release) => release.pluginKey === input.pluginKey,
  );
  if (!loadedRelease) return false;
  if (!access?.is_accessible) return false;
  if (!install?.enabled && !access.entitlement_is_forced) return false;

  const installedVersion = coalescePluginVersion(
    install?.installed_version ?? null,
    access.latest_version,
  );
  if (
    access.force_update_version &&
    isPluginVersionBehind(installedVersion, access.force_update_version)
  ) {
    return false;
  }
  return isPluginVersionWithinContractRange(
    installedVersion,
    loadedRelease.supportedInstallContracts,
  );
}
