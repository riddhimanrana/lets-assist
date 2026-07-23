#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

const EXPLICIT_SUPABASE_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_URL",
];

const GENERIC_SUPABASE_ENV_KEYS = [
  "API_URL",
  "ANON_KEY",
  "SERVICE_ROLE_KEY",
  "DB_URL",
];

const CSF_ISOLATED_PROJECT_PATTERN =
  /^(?=.{1,40}$)lets-assist-csf-browser-[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const CSF_ISOLATED_MARKER = ".lets-assist-csf-isolated-stack";

function parseEnvOutput(output) {
  const values = {};
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator);
    values[key] = line.slice(separator + 1).replace(/^["']|["']$/g, "");
  }
  return values;
}

function parseSingleConfigValue(source, key) {
  const matches = [...source.matchAll(
    new RegExp(`^\\s*${key}\\s*=\\s*(?:"([^"]+)"|(\\d+))\\s*$`, "gmu"),
  )];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${key} in the isolated Supabase config.`);
  }
  return matches[0][1] ?? matches[0][2];
}

function parseMarker(markerSource) {
  const values = parseEnvOutput(markerSource);
  const projectId = values.project_id?.trim();
  const basePort = Number(values.base_port);
  if (!projectId || !CSF_ISOLATED_PROJECT_PATTERN.test(projectId)) {
    throw new Error("CSF isolated stack marker has an invalid project_id.");
  }
  if (!Number.isInteger(basePort) || basePort < 1024 || basePort > 65526) {
    throw new Error("CSF isolated stack marker has an invalid base_port.");
  }
  return { projectId, basePort };
}

export function inspectCsfIsolatedWorkDir(workDirValue) {
  const requestedWorkDir = workDirValue?.trim();
  if (!requestedWorkDir) {
    throw new Error(
      "CSF local tooling requires CSF_ISOLATED_WORK_DIR from start-dvhs-csf-isolated-stack.sh.",
    );
  }
  if (!existsSync(requestedWorkDir)) {
    throw new Error(`CSF isolated work directory does not exist: ${requestedWorkDir}`);
  }

  const workDir = realpathSync(requestedWorkDir);
  const markerPath = path.join(workDir, CSF_ISOLATED_MARKER);
  const configPath = path.join(workDir, "supabase", "config.toml");
  if (!existsSync(markerPath) || !existsSync(configPath)) {
    throw new Error(
      "CSF isolated work directory is missing its generated marker or Supabase config.",
    );
  }

  const marker = parseMarker(readFileSync(markerPath, "utf8"));
  const config = readFileSync(configPath, "utf8");
  const configProjectId = parseSingleConfigValue(config, "project_id");
  const apiPortMatch = /\[api\][\s\S]*?^\s*port\s*=\s*(\d+)\s*$/mu.exec(config);
  const databasePortMatch = /\[db\][\s\S]*?^\s*port\s*=\s*(\d+)\s*$/mu.exec(config);
  if (!apiPortMatch || !databasePortMatch) {
    throw new Error("CSF isolated Supabase config is missing its API/database ports.");
  }
  const apiPort = Number(apiPortMatch[1]);
  const databasePort = Number(databasePortMatch[1]);

  if (configProjectId !== marker.projectId) {
    throw new Error("CSF isolated stack marker does not match the Supabase project_id.");
  }
  if (apiPort !== marker.basePort + 1 || databasePort !== marker.basePort + 2) {
    throw new Error("CSF isolated stack marker does not match its configured API/database ports.");
  }

  return {
    workDir,
    projectId: marker.projectId,
    apiPort,
    databasePort,
  };
}

export function assertLocalSupabaseUrl(value) {
  const url = new URL(value);
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`DV local tooling refuses non-local Supabase URL: ${url.origin}`);
  }
  return url.origin;
}

export function assertLocalPostgresUrl(value) {
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error(`Local Supabase tooling requires a Postgres URL, received: ${url.protocol}`);
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`Local Supabase tooling refuses non-local Postgres URL: ${url.hostname}`);
  }
  return value;
}

function hasProvidedValue(env, keys) {
  return keys.some((key) => Boolean(env[key]?.trim()));
}

function firstProvidedValue(env, keys) {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function assertCompleteBundle(label, values) {
  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `${label} Supabase environment is incomplete; missing ${missing.join(", ")}. ` +
        "Refusing to combine it with another environment source.",
    );
  }
}

function normalizeLoopbackHost(hostname) {
  return LOCAL_HOSTS.has(hostname) ? "loopback" : hostname;
}

function assertCoherentLocalSupabaseBundle(rawUrl, dbUrl) {
  const api = new URL(rawUrl);
  const database = new URL(dbUrl);
  const apiPort = Number(api.port);
  const databasePort = Number(database.port);

  if (
    normalizeLoopbackHost(api.hostname) !==
    normalizeLoopbackHost(database.hostname)
  ) {
    throw new Error(
      "Local Supabase API and database URLs must use the same loopback host.",
    );
  }

  if (
    !Number.isInteger(apiPort) ||
    !Number.isInteger(databasePort) ||
    apiPort <= 0 ||
    databasePort !== apiPort + 1
  ) {
    throw new Error(
      "Local Supabase database port must be exactly one greater than the API port.",
    );
  }
}

function normalizedLoopbackEndpoint(value) {
  const url = new URL(value);
  return `${url.protocol}//loopback:${url.port}`;
}

function assertBundleMatchesStatus(provided, statusValues, label) {
  const status = resolveProvidedLocalSupabaseEnv(statusValues);
  if (!status) {
    throw new Error(`${label} Supabase status did not return a complete environment bundle.`);
  }

  if (
    normalizedLoopbackEndpoint(provided.url) !==
      normalizedLoopbackEndpoint(status.url) ||
    normalizedLoopbackEndpoint(provided.dbUrl) !==
      normalizedLoopbackEndpoint(status.dbUrl)
  ) {
    throw new Error(
      `${label} environment does not match the selected Let’s Assist Supabase stack. Refusing an ambient Vela or mixed-stack connection.`,
    );
  }

  const allowedAnonKeys = new Set(
    [statusValues.ANON_KEY, statusValues.PUBLISHABLE_KEY].filter(Boolean),
  );
  const allowedServiceKeys = new Set(
    [statusValues.SERVICE_ROLE_KEY, statusValues.SECRET_KEY].filter(Boolean),
  );
  if (
    !allowedAnonKeys.has(provided.anonKey) ||
    !allowedServiceKeys.has(provided.serviceRoleKey)
  ) {
    throw new Error(
      `${label} credentials do not belong to the selected Let’s Assist Supabase stack.`,
    );
  }
}

export function assertProvidedLocalSupabaseEnvMatchesStatus(
  providedEnvironment,
  statusValues,
  label = "Let’s Assist local",
) {
  const provided = resolveProvidedLocalSupabaseEnv(providedEnvironment);
  if (!provided) {
    throw new Error(`${label} environment did not provide a complete Supabase bundle.`);
  }
  assertBundleMatchesStatus(provided, statusValues, label);
  return provided;
}

function readLocalSupabaseStatus(workDir) {
  const args = ["status", "-o", "env"];
  if (workDir) args.push("--workdir", workDir);
  const output = execFileSync("supabase", args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (/Stopped services:/i.test(output)) {
    throw new Error(
      "Selected Let’s Assist Supabase stack is stopped. Start it before running local tooling.",
    );
  }
  return parseEnvOutput(output);
}

function getValidatedLocalSupabaseEnv(env, { requireCsfIsolated = false } = {}) {
  const isolated = env.CSF_ISOLATED_WORK_DIR
    ? inspectCsfIsolatedWorkDir(env.CSF_ISOLATED_WORK_DIR)
    : null;
  if (requireCsfIsolated && !isolated) {
    throw new Error(
      "CSF service-role tooling requires an explicit generated CSF isolated stack.",
    );
  }

  const statusValues = readLocalSupabaseStatus(isolated?.workDir);
  const status = resolveProvidedLocalSupabaseEnv(statusValues);
  if (!status) {
    throw new Error("Local Supabase status did not return a complete environment bundle.");
  }
  const provided = resolveProvidedLocalSupabaseEnv(env);
  if (provided) {
    return assertProvidedLocalSupabaseEnvMatchesStatus(
      env,
      statusValues,
      isolated ? `CSF isolated project ${isolated.projectId}` : "Let’s Assist local",
    );
  }
  return status;
}

/**
 * @param {Record<string, string | undefined>} [env]
 */
export function resolveProvidedLocalSupabaseEnv(env = process.env) {
  const hasExplicitBundle = hasProvidedValue(env, EXPLICIT_SUPABASE_ENV_KEYS);
  const hasGenericBundle = hasProvidedValue(env, GENERIC_SUPABASE_ENV_KEYS);

  if (!hasExplicitBundle && !hasGenericBundle) return null;

  const values = hasExplicitBundle
    ? {
        rawUrl: firstProvidedValue(env, [
          "NEXT_PUBLIC_SUPABASE_URL",
          "SUPABASE_URL",
        ]),
        anonKey: firstProvidedValue(env, [
          "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
          "NEXT_PUBLIC_SUPABASE_ANON_KEY",
          "SUPABASE_ANON_KEY",
        ]),
        serviceRoleKey: firstProvidedValue(env, [
          "SUPABASE_SECRET_KEY",
          "SUPABASE_SERVICE_ROLE_KEY",
        ]),
        dbUrl: firstProvidedValue(env, ["SUPABASE_DB_URL"]),
      }
    : {
        rawUrl: firstProvidedValue(env, ["API_URL"]),
        anonKey: firstProvidedValue(env, ["ANON_KEY"]),
        serviceRoleKey: firstProvidedValue(env, ["SERVICE_ROLE_KEY"]),
        dbUrl: firstProvidedValue(env, ["DB_URL"]),
      };

  assertCompleteBundle(
    hasExplicitBundle ? "Explicit Let’s Assist" : "Generic local",
    values,
  );
  const url = assertLocalSupabaseUrl(values.rawUrl);
  const dbUrl = assertLocalPostgresUrl(values.dbUrl);
  assertCoherentLocalSupabaseBundle(url, dbUrl);

  return {
    url,
    serviceRoleKey: values.serviceRoleKey,
    anonKey: values.anonKey,
    dbUrl,
  };
}

/**
 * @param {Record<string, string | undefined>} [env]
 */
export function getLocalSupabaseEnv(env = process.env) {
  return getValidatedLocalSupabaseEnv(env);
}

/**
 * @param {Record<string, string | undefined>} [env]
 */
export function getCsfIsolatedSupabaseEnv(env = process.env) {
  return getValidatedLocalSupabaseEnv(env, { requireCsfIsolated: true });
}

/**
 * @param {Record<string, string | undefined>} [env]
 */
export function getLocalSupabaseDbUrl(env = process.env) {
  return getValidatedLocalSupabaseEnv(env).dbUrl;
}

if (process.argv.includes("--health")) {
  const env = getLocalSupabaseEnv();
  console.log(JSON.stringify({ ok: true, url: env.url }));
}

const isEntrypoint = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isEntrypoint && !process.argv.includes("--health")) {
  if (process.argv.includes("--db-url")) {
    console.log(getLocalSupabaseDbUrl());
  } else {
    console.log(JSON.stringify(getLocalSupabaseEnv()));
  }
}
