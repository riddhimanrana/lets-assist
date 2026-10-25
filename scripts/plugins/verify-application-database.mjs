import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { acceptedCatalogQuery } from "../production/app-release-catalog.mjs";
import {
  expectedVersions,
  productionRef,
  readJson,
  ReleaseCheckError,
  safeFailureMessage,
  verifyLedger,
  verifySchema,
} from "../production/app-release-checks.mjs";
import { verifyApplicationDeployment } from "./verify-application-deployment.mjs";

function refuse(message) {
  throw new ReleaseCheckError(message);
}

function databaseTarget(environment, env) {
  const branch = environment === "production" ? "main" : "development";
  const projectRef =
    environment === "production"
      ? productionRef
      : env.CSF_DEVELOPMENT_SUPABASE_PROJECT_REF;
  if (
    !["development", "production"].includes(environment) ||
    env.GITHUB_REF !== `refs/heads/${branch}` ||
    !/^[a-z0-9]{20}$/u.test(projectRef ?? "") ||
    (environment === "development" && projectRef === productionRef) ||
    env.SUPABASE_PROJECT_ID !== projectRef
  )
    refuse("Plugin deployment database environment binding is invalid.");

  const origin = env.SUPABASE_URL?.replace(/\/$/u, "");
  const approvedOrigins = [`https://${projectRef}.supabase.co`];
  if (environment === "production")
    approvedOrigins.push("https://api.lets-assist.com");
  if (!approvedOrigins.includes(origin))
    refuse("Plugin deployment database origin does not match its environment.");
  if (!env.SUPABASE_ACCESS_TOKEN?.trim())
    refuse("The selected environment has no database-management credential.");
  if (!env.SUPABASE_SERVICE_ROLE_KEY?.trim())
    refuse(
      "The selected environment has no deployment-observation credential.",
    );
  return { projectRef, origin };
}

async function verifyDevelopmentSchema(config, versions, catalog, fetcher) {
  const request = (query, ownerCatalog = false) =>
    readJson(
      `https://api.supabase.com/v1/projects/${config.projectRef}/database/query${ownerCatalog ? "" : "/read-only"}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          ownerCatalog
            ? {
                query: `BEGIN READ ONLY;\nSET LOCAL search_path TO public, extensions;\n${query};\nCOMMIT;`,
              }
            : { query, read_only: true },
        ),
      },
      fetcher,
    );
  const ledger = await request(
    "SELECT version::text FROM supabase_migrations.schema_migrations ORDER BY version;",
  );
  try {
    verifyLedger(ledger, versions);
  } catch {
    refuse(
      "Development migration sequence differs from the accepted application.",
    );
  }
  const result = await request(catalog, true);
  if (result?.length !== 1 || result[0].csf_target_schema_verified !== 1)
    refuse("Development plugin deployment catalog verification failed.");
  return {
    migrations: versions.length,
    head: versions.at(-1),
    catalog: "verified",
  };
}

export async function verifyApplicationDatabase(
  { deployment, env = process.env, cwd = process.cwd() },
  fetcher = fetch,
) {
  const { projectRef, origin } = databaseTarget(deployment.environment, env);
  const release = verifyApplicationDeployment(deployment);
  const versions = expectedVersions(cwd);
  if (!versions.includes(release.requiredPlatformSchemaVersion))
    refuse(
      "The signed plugin schema requirement is absent from the host ledger.",
    );
  const catalog = acceptedCatalogQuery(
    readFileSync(
      resolve(cwd, "scripts/production/verify-csf-target-schema.sql"),
      "utf8",
    ),
    versions,
  );
  const config = { projectRef, token: env.SUPABASE_ACCESS_TOKEN, cwd };
  const schema =
    deployment.environment === "production"
      ? await verifySchema(config, fetcher)
      : await verifyDevelopmentSchema(config, versions, catalog, fetcher);

  // Read immutable release coordinates through the same API origin and key
  // used for later deployment observations. This request never changes state.
  const published = {
    plugin_key: release.pluginKey,
    version: release.version,
    status: "published",
    runtime_profile: "application",
    commit_sha: release.sourceCommit,
    required_platform_schema_version: release.requiredPlatformSchemaVersion,
    build_digest: release.releaseBuildDigest,
  };
  const query = new URLSearchParams({
    select: Object.keys(published).join(","),
    plugin_key: `eq.${release.pluginKey}`,
    version: `eq.${release.version}`,
    limit: "2",
  });
  const records = await readJson(
    `${origin}/rest/v1/plugin_versions?${query}`,
    {
      method: "GET",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
    fetcher,
  );
  if (
    !Array.isArray(records) ||
    records.length !== 1 ||
    Object.entries(published).some(
      ([key, value]) => records[0]?.[key] !== value,
    )
  )
    refuse(
      "The target database does not expose the exact signed plugin publication.",
    );
  return {
    environment: deployment.environment,
    projectRef,
    pluginKey: release.pluginKey,
    version: release.version,
    requiredPlatformSchemaVersion: release.requiredPlatformSchemaVersion,
    ...schema,
    publication: "verified",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = new Map();
    for (let index = 2; index < process.argv.length; index += 2) {
      if (
        !process.argv[index]?.startsWith("--") ||
        process.argv[index + 1] === undefined
      )
        refuse("Expected named plugin database verification arguments.");
      args.set(process.argv[index], process.argv[index + 1]);
    }
    const result = await verifyApplicationDatabase({
      deployment: {
        manifestPath: args.get("--manifest"),
        registryPath: args.get("--registry"),
        targetsPath: args.get("--targets"),
        buildPath: args.get("--build"),
        releaseTag: args.get("--tag"),
        pluginKey: args.get("--plugin"),
        environment: args.get("--environment"),
      },
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${safeFailureMessage(error)}\n`);
    process.exitCode = 1;
  }
}
