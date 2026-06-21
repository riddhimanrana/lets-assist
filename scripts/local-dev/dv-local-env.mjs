#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

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

export function assertLocalSupabaseUrl(value) {
  const url = new URL(value);
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`DV local tooling refuses non-local Supabase URL: ${url.origin}`);
  }
  return url.origin;
}

export function getLocalSupabaseEnv() {
  const output = execFileSync("supabase", ["status", "-o", "env"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const status = parseEnvOutput(output);
  const url = assertLocalSupabaseUrl(
    status.API_URL ?? status.SUPABASE_URL ?? "http://127.0.0.1:54321",
  );
  const serviceRoleKey = status.SERVICE_ROLE_KEY ?? status.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = status.ANON_KEY ?? status.SUPABASE_ANON_KEY;

  if (!serviceRoleKey || !anonKey) {
    throw new Error("Local Supabase status did not return service-role and anon keys.");
  }

  return { url, serviceRoleKey, anonKey };
}

if (process.argv.includes("--health")) {
  const env = getLocalSupabaseEnv();
  console.log(JSON.stringify({ ok: true, url: env.url }));
}

const isEntrypoint = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isEntrypoint && !process.argv.includes("--health")) {
  console.log(JSON.stringify(getLocalSupabaseEnv()));
}
