import { execFileSync } from "node:child_process";
import { productionRef, ReleaseCheckError } from "./app-release-checks.mjs";

const refuse = () => {
  throw new ReleaseCheckError(
    "Production linked psql transport failed. Raw output was suppressed.",
  );
};
const validPassword = (value) =>
  typeof value === "string" &&
  value.trim() &&
  ![...value].some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
const validHost = (host) =>
  typeof host === "string" && /^[a-z0-9-]+\.pooler\.supabase\.com$/u.test(host);

// The legacy URL supplies TLS policy only; never use its route or credentials.
export function productionTransportConfig(env) {
  let sslmode = "require";
  const legacy = env.PRODUCTION_BOOTSTRAP_DATABASE_URL;
  if (legacy) {
    try {
      const url = new URL(legacy);
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        url.searchParams.getAll("sslmode").length > 1
      )
        return refuse();
      sslmode = url.searchParams.get("sslmode") ?? "require";
    } catch {
      return refuse();
    }
  }
  if (!["require", "verify-ca", "verify-full"].includes(sslmode))
    return refuse();
  if (
    typeof env.SUPABASE_ACCESS_TOKEN !== "string" ||
    !env.SUPABASE_ACCESS_TOKEN.trim() ||
    !validPassword(env.SUPABASE_DB_PASSWORD)
  )
    return refuse();
  return {
    accessToken: env.SUPABASE_ACCESS_TOKEN,
    databasePassword: env.SUPABASE_DB_PASSWORD,
    sslmode,
  };
}

export function validateLinkedConnection(connection) {
  if (
    !connection ||
    !validHost(connection.host) ||
    connection.port !== "5432" ||
    connection.user !== `postgres.${productionRef}` ||
    connection.database !== "postgres" ||
    !["require", "verify-ca", "verify-full"].includes(connection.sslmode)
  )
    return refuse();
}

// Official GET /v1/projects/{ref}/config/database/pooler response fields.
// Ignore connection_string entirely. CLI 2.120.0 link-services-core.ts selects
// session port 5432 for the PRIMARY shared pooler when it reports transaction
// mode 6543. Session mode is required for the unchanged psql transaction script.
export function linkedBootstrapConnection(configs) {
  if (!Array.isArray(configs)) return refuse();
  const primary = configs.filter((entry) => entry?.database_type === "PRIMARY");
  if (primary.length !== 1) return refuse();
  const row = primary[0];
  if (
    !validHost(row.db_host) ||
    row.db_user !== `postgres.${productionRef}` ||
    row.db_name !== "postgres" ||
    !(
      (row.pool_mode === "session" && row.db_port === 5432) ||
      (row.pool_mode === "transaction" && row.db_port === 6543)
    )
  )
    return refuse();
  return Object.freeze({
    host: row.db_host,
    port: "5432",
    user: row.db_user,
    database: "postgres",
    sslmode: "require",
  });
}

export async function prepareLinkedBootstrapConnection(
  config,
  fetcher = fetch,
) {
  try {
    if (
      typeof config.accessToken !== "string" ||
      !config.accessToken.trim() ||
      !validPassword(config.databasePassword)
    )
      return refuse();
    const response = await fetcher(
      `https://api.supabase.com/v1/projects/${productionRef}/config/database/pooler`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${config.accessToken}` },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (response.status !== 200) return refuse();
    const connection = linkedBootstrapConnection(await response.json());
    const sslmode = config.sslmode ?? "require";
    const result = Object.freeze({ ...connection, sslmode });
    validateLinkedConnection(result);
    return result;
  } catch {
    return refuse();
  }
}

export function executeLinkedBootstrapQuery(
  connection,
  sql,
  password,
  execute = execFileSync,
  policy = {},
) {
  try {
    validateLinkedConnection(connection);
    if (!validPassword(password)) return refuse();
    return execute("psql", ["-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], {
      input: sql,
      encoding: "utf8",
      timeout: policy.timeout ?? 150_000,
      maxBuffer: 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH,
        LANG: "C",
        PGHOST: connection.host,
        PGPORT: connection.port,
        PGUSER: connection.user,
        PGPASSWORD: password,
        PGDATABASE: connection.database,
        PGSSLMODE: connection.sslmode,
        PGCONNECT_TIMEOUT: "15",
        ...(policy.readOnly
          ? {
              PGOPTIONS:
                "-c default_transaction_read_only=on -c search_path=pg_catalog -c statement_timeout=120000 -c lock_timeout=5000",
            }
          : {}),
      },
    }).trim();
  } catch {
    return refuse();
  }
}
