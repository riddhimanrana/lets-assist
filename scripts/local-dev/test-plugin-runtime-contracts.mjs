#!/usr/bin/env bun

import { createClient } from "@supabase/supabase-js";
import { mock } from "bun:test";
import { execFileSync } from "node:child_process";
import { getLocalSupabaseEnv } from "./dv-local-env.mjs";

// Registry definitions are server-only, while this audit runs in plain Bun.
mock.module("server-only", () => ({}));

const { url, serviceRoleKey } = getLocalSupabaseEnv();

process.env.NEXT_PUBLIC_SUPABASE_URL = url;
process.env.SUPABASE_SECRET_KEY = serviceRoleKey;

const { privatePlugins } = await import("../../lib/plugins/private/registry.ts");
const { syncRegisteredPluginRuntimeContracts } = await import(
  "../../lib/plugins/runtime-contracts.ts"
);

const admin = createClient(url, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const registeredPluginKeys = privatePlugins
  .map((definition) => definition.manifest?.key)
  .filter((key) => typeof key === "string")
  .sort();

if (registeredPluginKeys.length === 0) {
  throw new Error("No private plugins are registered; contract audit cannot prove plugin boundaries.");
}

const catalogRows = privatePlugins.map((definition) => {
  const manifest = definition.manifest;
  return {
    key: manifest.key,
    name: manifest.name,
    description: manifest.description,
    visibility: manifest.visibility,
    is_active: true,
    latest_version: manifest.version,
    private_codebase: manifest.visibility === "private",
    required_scopes: manifest.requiredScopes ?? [],
    config_schema: manifest.configSchema ?? null,
    metadata: {
      owner: manifest.owner ?? null,
      capabilityHighlights: manifest.capabilityHighlights ?? [],
      navLabel: manifest.navLabel ?? null,
      syncedFromRegistry: true,
    },
  };
});

const { error: catalogUpsertError } = await admin
  .from("plugins")
  .upsert(catalogRows, { onConflict: "key" });

if (catalogUpsertError) {
  throw new Error(`Failed to sync registered plugin catalog rows: ${catalogUpsertError.message}`);
}

const syncResult = await syncRegisteredPluginRuntimeContracts();

const { data: contractRows, error: contractError } = await admin
  .from("plugin_runtime_contracts")
  .select("plugin_key, data_access, storage_access, backend_capabilities, routes")
  .in("plugin_key", registeredPluginKeys)
  .order("plugin_key");

if (contractError) {
  throw new Error(`Failed to read plugin runtime contracts: ${contractError.message}`);
}

const contractKeys = new Set((contractRows ?? []).map((row) => row.plugin_key));
const missingContracts = registeredPluginKeys.filter((key) => !contractKeys.has(key));

if (missingContracts.length > 0) {
  throw new Error(`Missing runtime contracts for registered plugins: ${missingContracts.join(", ")}`);
}

const contractFailures = [];
for (const row of contractRows ?? []) {
  const dataAccess = Array.isArray(row.data_access) ? row.data_access : [];

  if (dataAccess.length === 0) {
    contractFailures.push(`${row.plugin_key}: data_access is empty`);
    continue;
  }

  for (const [index, declaration] of dataAccess.entries()) {
    if (!declaration || typeof declaration !== "object" || Array.isArray(declaration)) {
      contractFailures.push(`${row.plugin_key}: data_access[${index}] is not an object`);
      continue;
    }

    const { schema, relation, access, purpose, tenantColumn, containsPersonalData, containsSensitiveData } =
      declaration;
    if (typeof schema !== "string" || typeof relation !== "string" || typeof access !== "string" || typeof purpose !== "string") {
      contractFailures.push(`${row.plugin_key}: data_access[${index}] is missing schema/relation/access/purpose`);
    }

    if (schema === "plugin_data" && access === "rls-client") {
      contractFailures.push(`${row.plugin_key}: ${schema}.${relation} still declares raw rls-client access`);
    }

    if (
      (schema === "plugin_data" || schema === "public") &&
      (containsPersonalData === true || containsSensitiveData === true) &&
      typeof tenantColumn !== "string"
    ) {
      contractFailures.push(`${row.plugin_key}: ${schema}.${relation} handles personal/sensitive data without tenantColumn`);
    }
  }
}

const dvContract = (contractRows ?? []).find(
  (row) => row.plugin_key === "dv-speech-debate",
);
if (dvContract) {
  const dbUrl =
    process.env.SUPABASE_DB_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  const actualDvRelations = execFileSync(
    "psql",
    [
      dbUrl,
      "-Atc",
      "select table_name from information_schema.tables where table_schema = 'plugin_data' and table_type = 'BASE TABLE' and table_name like 'dv_sd_%' order by table_name",
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean);
  const declarations = Array.isArray(dvContract.data_access)
    ? dvContract.data_access
    : [];
  const declaredByRelation = new Map(
    declarations
      .filter(
        (declaration) =>
          declaration &&
          typeof declaration === "object" &&
          !Array.isArray(declaration) &&
          declaration.schema === "plugin_data" &&
          typeof declaration.relation === "string",
      )
      .map((declaration) => [declaration.relation, declaration]),
  );
  const requiredRelations = [
    ...actualDvRelations,
    "org_form_definitions",
    "org_form_submissions",
    "org_member_profiles",
    "org_seasons",
  ];
  const missingRelations = requiredRelations.filter(
    (relation) => !declaredByRelation.has(relation),
  );
  if (missingRelations.length > 0) {
    contractFailures.push(
      `dv-speech-debate: runtime contract omits plugin_data relations: ${missingRelations.join(", ")}`,
    );
  }
  const nonServerOnly = [...declaredByRelation.entries()]
    .filter(([, declaration]) => declaration.access !== "server-only")
    .map(([relation]) => relation);
  if (nonServerOnly.length > 0) {
    contractFailures.push(
      `dv-speech-debate: plugin_data relations are not server-only: ${nonServerOnly.join(", ")}`,
    );
  }
}

const { data: unsafeBoundaries, error: unsafeBoundaryError } = await admin
  .from("organization_plugin_data_boundaries")
  .select("organization_id, plugin_key, direct_client_access")
  .eq("direct_client_access", "rls_allowed")
  .limit(20);

if (unsafeBoundaryError) {
  throw new Error(`Failed to read plugin data boundaries: ${unsafeBoundaryError.message}`);
}

if ((unsafeBoundaries ?? []).length > 0) {
  contractFailures.push(
    `Plugin data boundaries allow direct client access: ${JSON.stringify(unsafeBoundaries)}`,
  );
}

const { data: organizations, error: orgError } = await admin
  .from("organizations")
  .select("id");

if (orgError) {
  throw new Error(`Failed to read organizations: ${orgError.message}`);
}

const { data: isolationProfiles, error: profileError } = await admin
  .from("organization_data_isolation_profiles")
  .select("organization_id");

if (profileError) {
  throw new Error(`Failed to read organization isolation profiles: ${profileError.message}`);
}

const profileOrgIds = new Set((isolationProfiles ?? []).map((row) => row.organization_id));
const orgsWithoutProfiles = (organizations ?? [])
  .map((row) => row.id)
  .filter((id) => !profileOrgIds.has(id));

if (orgsWithoutProfiles.length > 0) {
  contractFailures.push(
    `Organizations missing data isolation profiles: ${orgsWithoutProfiles.join(", ")}`,
  );
}

if (contractFailures.length > 0) {
  throw new Error(`Plugin runtime contract audit failed:\n- ${contractFailures.join("\n- ")}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      syncResult,
      registeredPluginKeys,
      contracts: contractRows?.length ?? 0,
      organizations: organizations?.length ?? 0,
      isolationProfiles: isolationProfiles?.length ?? 0,
    },
    null,
    2,
  ),
);
