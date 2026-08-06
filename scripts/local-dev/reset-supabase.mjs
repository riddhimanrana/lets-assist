#!/usr/bin/env node

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  return result;
}

function latestMigrationVersion() {
  const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
  const migrations = readdirSync(migrationsDir)
    .map((fileName) => fileName.match(/^(\d{14})_.+\.sql$/)?.[1])
    .filter(Boolean)
    .sort();

  return migrations.at(-1);
}

const reset = run("supabase", ["db", "reset", "--local", "--yes"]);

if (reset.status === 0) {
  process.exit(0);
}

const output = `${reset.stdout ?? ""}\n${reset.stderr ?? ""}`;
const looksLikePostMigrationStorage502 =
  output.includes("Restarting containers") &&
  output.includes("Error status 502") &&
  output.includes("invalid response was received from the upstream server");

if (!looksLikePostMigrationStorage502) {
  process.exit(reset.status ?? 1);
}

console.warn(
  "[local-reset] Supabase reset applied migrations but storage health returned 502 during container restart.",
);
console.warn(
  "[local-reset] Restarting the local Supabase stack and verifying migration history.",
);

const stop = run("supabase", ["stop"]);
if (stop.status !== 0) process.exit(stop.status ?? 1);

const start = run("supabase", ["start"]);
if (start.status !== 0) process.exit(start.status ?? 1);

const expectedVersion = latestMigrationVersion();
if (!expectedVersion) {
  console.error("[local-reset] Could not determine latest migration version.");
  process.exit(1);
}

const migrationList = run("supabase", ["migration", "list", "--local"]);
if (migrationList.status !== 0) process.exit(migrationList.status ?? 1);

const listOutput = `${migrationList.stdout ?? ""}\n${migrationList.stderr ?? ""}`;
if (!listOutput.includes(expectedVersion)) {
  console.error(
    `[local-reset] Latest migration ${expectedVersion} is missing after storage 502 recovery.`,
  );
  process.exit(1);
}

console.warn(
  `[local-reset] Recovered from post-migration storage 502; latest migration ${expectedVersion} is applied.`,
);
