#!/usr/bin/env node

import fs from "node:fs";
import { fileURLToPath } from "node:url";

const VERSION_PATTERN = /^\d{14}$/u;

function getMigrationRows(payload) {
  const migrations = Array.isArray(payload) ? payload : payload?.migrations;
  if (!Array.isArray(migrations)) {
    throw new Error("Supabase migration output does not contain a migrations array.");
  }
  if (migrations.length === 0) {
    throw new Error("Supabase migration output is empty; parity cannot be verified.");
  }
  return migrations;
}

function normalizeVersion(value) {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }
  return typeof value === "string" ? value.trim() : "";
}

function compareVersionSets(label, actualVersions, expectedVersions) {
  const actual = new Set(actualVersions);
  const expected = new Set(expectedVersions);
  const missing = [...expected].filter((version) => !actual.has(version));
  const unexpected = [...actual].filter((version) => !expected.has(version));
  const duplicates = actualVersions.filter(
    (version, index) => actualVersions.indexOf(version) !== index,
  );

  if (missing.length || unexpected.length || duplicates.length) {
    const details = [
      missing.length ? `missing ${missing.join(", ")}` : "",
      unexpected.length ? `unexpected ${unexpected.join(", ")}` : "",
      duplicates.length ? `duplicate ${[...new Set(duplicates)].join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    throw new Error(`${label} migration set does not match tracked files: ${details}.`);
  }
}

export function readTrackedMigrationVersions(migrationsDirectory) {
  const filenames = fs
    .readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  if (filenames.length === 0) {
    throw new Error("No tracked Supabase migration files were found.");
  }

  return filenames.map((filename) => {
    const match = /^(\d{14})_[a-z0-9_]+\.sql$/u.exec(filename);
    if (!match) {
      throw new Error(`Invalid tracked Supabase migration filename: ${filename}`);
    }
    return match[1];
  });
}

export function findSupabaseMigrationMismatches(payload) {
  const migrations = getMigrationRows(payload);

  return migrations.filter((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return true;
    const local = normalizeVersion(row.local);
    const remote = normalizeVersion(row.remote);
    return (
      !VERSION_PATTERN.test(local) ||
      !VERSION_PATTERN.test(remote) ||
      local !== remote
    );
  });
}

export function assertSupabaseMigrationParity(payload, trackedVersions) {
  if (!Array.isArray(trackedVersions) || trackedVersions.length === 0) {
    throw new Error("Tracked Supabase migration versions are required for parity.");
  }
  if (trackedVersions.some((version) => !VERSION_PATTERN.test(version))) {
    throw new Error("Tracked Supabase migration versions contain an invalid timestamp.");
  }
  if (new Set(trackedVersions).size !== trackedVersions.length) {
    throw new Error("Tracked Supabase migration versions contain a duplicate timestamp.");
  }

  const mismatches = findSupabaseMigrationMismatches(payload);
  if (mismatches.length) {
    const summary = mismatches
      .map(
        (row) =>
          `${normalizeVersion(row?.local) || "missing"} != ${normalizeVersion(row?.remote) || "missing"}`,
      )
      .join(", ");
    throw new Error(
      `${mismatches.length} Supabase migration-history mismatch(es): ${summary}`,
    );
  }

  const rows = getMigrationRows(payload);
  const localVersions = rows.map((row) => normalizeVersion(row.local));
  const remoteVersions = rows.map((row) => normalizeVersion(row.remote));
  compareVersionSets("CLI local", localVersions, trackedVersions);
  compareVersionSets("CLI remote", remoteVersions, trackedVersions);
}

const isEntrypoint = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isEntrypoint) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error(
      "Usage: verify-supabase-migration-parity.mjs <migration-list.json> [migrations-directory]",
    );
    process.exit(2);
  }

  try {
    const payload = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    const migrationsDirectory = process.argv[3] ?? "supabase/migrations";
    const trackedVersions = readTrackedMigrationVersions(migrationsDirectory);
    assertSupabaseMigrationParity(payload, trackedVersions);
    console.log("Supabase migration history matches the repository.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
