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

type PluginReleaseDefinition = Pick<OrganizationPluginDefinition, "manifest">;
type PluginCatalogReleaseRow = {
  key: string;
  latest_version: string;
  is_active: boolean;
};
type PublishedReleaseRow = {
  plugin_key: string;
  version: string;
};

export function assertPluginReleaseAlignment(input: {
  definitions: readonly PluginReleaseDefinition[];
  catalogRows: readonly PluginCatalogReleaseRow[];
  publishedRows: readonly PublishedReleaseRow[];
}): void {
  const catalogByKey = new Map(input.catalogRows.map((row) => [row.key, row]));
  const published = new Set(
    input.publishedRows.map((row) => `${row.plugin_key}@${row.version}`),
  );

  for (const definition of input.definitions) {
    const { key, version } = definition.manifest;
    const catalog = catalogByKey.get(key);
    if (!catalog) {
      throw new Error(`Registered plugin ${key} is missing from the catalog.`);
    }
    if (!catalog.is_active) {
      throw new Error(`Registered plugin ${key} is inactive in the catalog.`);
    }
    if (catalog.latest_version !== version) {
      throw new Error(
        `Plugin ${key} manifest ${version} does not match catalog ${catalog.latest_version}.`,
      );
    }
    if (!published.has(`${key}@${version}`)) {
      throw new Error(
        `Plugin ${key}@${version} has no authoritative published release.`,
      );
    }
  }
}

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
    .select("key, latest_version, is_active");

  if (catalogError) {
    throw new Error(
      `Failed to load plugin catalog for contract sync: ${catalogError.message}`,
    );
  }

  const registeredPlugins = listRegisteredPlugins();
  const registeredKeys = registeredPlugins.map(
    (definition) => definition.manifest.key,
  );
  const { data: publishedRows, error: publishedError } = await service
    .from("plugin_versions")
    .select("plugin_key, version")
    .eq("status", "published")
    .in("plugin_key", registeredKeys);
  if (publishedError) {
    throw new Error(
      `Failed to load published plugin releases: ${publishedError.message}`,
    );
  }

  assertPluginReleaseAlignment({
    definitions: registeredPlugins,
    catalogRows: (catalogRows ?? []) as PluginCatalogReleaseRow[],
    publishedRows: (publishedRows ?? []) as PublishedReleaseRow[],
  });
  const rows = registeredPlugins.map((definition) =>
    buildPluginRuntimeContractRow(definition),
  );

  if (rows.length === 0) {
    return { synced: 0, skipped: [] as string[] };
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
    skipped: [] as string[],
  };
}
