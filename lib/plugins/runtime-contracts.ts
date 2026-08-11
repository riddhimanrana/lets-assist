import { getAdminClient } from "@/lib/supabase/admin";
import { listRegisteredPlugins } from "@/lib/plugins/registry";
import type { OrganizationPluginDefinition } from "@/types";

type RuntimeContractRow = {
  plugin_key: string;
  manifest_version: string;
  minimum_role: string;
  routes: unknown[];
  surfaces: string[];
  behavior_hooks: string[];
  backend_capabilities: unknown[];
  data_access: unknown[];
  storage_access: unknown[];
  required_scopes: string[];
  lifecycle_hooks: string[];
  synced_at: string;
  updated_at: string;
};

function objectKeys(value: Record<string, unknown> | undefined): string[] {
  return value ? Object.keys(value).sort() : [];
}

function lifecycleKeys(definition: OrganizationPluginDefinition): string[] {
  if (!definition.lifecycle) return [];

  return Object.entries(definition.lifecycle)
    .filter(([, value]) => typeof value === "function")
    .map(([key]) => key)
    .sort();
}

export function buildPluginRuntimeContractRow(
  definition: OrganizationPluginDefinition,
  now = new Date(),
): RuntimeContractRow {
  const { manifest } = definition;
  const dataAccess = manifest.dataAccess?.length
    ? manifest.dataAccess
    : (manifest.dataScope ?? []).map((relation) => ({
        schema: relation.includes(".") ? relation.split(".")[0] : "plugin_data",
        relation: relation.includes(".")
          ? relation.split(".").slice(1).join(".")
          : relation,
        access: "rls-client",
        purpose:
          "Legacy plugin data scope. Convert to structured dataAccess before revoking direct Data API exposure.",
      }));

  return {
    plugin_key: manifest.key,
    manifest_version: manifest.version,
    minimum_role: manifest.minimumRole ?? "member",
    routes: manifest.routes ?? [],
    surfaces: objectKeys(manifest.surfaceAccess),
    behavior_hooks: objectKeys(manifest.behaviorAccess),
    backend_capabilities: manifest.backendCapabilities ?? [],
    data_access: dataAccess,
    storage_access: manifest.storageAccess ?? [],
    required_scopes: manifest.requiredScopes ?? [],
    lifecycle_hooks: lifecycleKeys(definition),
    synced_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
}

export async function syncRegisteredPluginRuntimeContracts() {
  const service = getAdminClient();

  const { data: catalogRows, error: catalogError } = await service
    .from("plugins")
    .select("key");

  if (catalogError) {
    throw new Error(
      `Failed to load plugin catalog for contract sync: ${catalogError.message}`,
    );
  }

  const catalogKeys = new Set(
    (catalogRows ?? []).map((row) => row.key as string),
  );
  const registeredPlugins = listRegisteredPlugins();
  const rows = registeredPlugins
    .filter((definition) => catalogKeys.has(definition.manifest.key))
    .map((definition) => buildPluginRuntimeContractRow(definition));

  const skipped = registeredPlugins.filter(
    (definition) => !catalogKeys.has(definition.manifest.key),
  );

  if (rows.length === 0) {
    return {
      synced: 0,
      skipped: skipped.map((definition) => definition.manifest.key),
    };
  }

  const { error } = await service
    .from("plugin_runtime_contracts")
    .upsert(rows, { onConflict: "plugin_key" });

  if (error) {
    throw new Error(
      `Failed to sync plugin runtime contracts: ${error.message}`,
    );
  }

  return {
    synced: rows.length,
    skipped: skipped.map((definition) => definition.manifest.key),
  };
}
