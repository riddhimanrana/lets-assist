import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { getCsfIsolatedSupabaseEnv } from "../local-dev/dv-local-env.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
import { finalSchemaInventory } from "./final-schema-manifest.mjs";
import {
  assertCleanInventory,
  generateFinalSchemaManifest,
} from "./generate-final-schema-manifest.mjs";
import { isolatedReleaseCatalogQuery } from "./isolated-release-catalog.mjs";

// Diagnostic metadata from the same owned, unseeded replay used by CI. The
// existing catalog gate still decides acceptance; this never registers a new
// catalog or produces an acceptance receipt.
export function captureIsolatedReleaseInventory({
  cwd = resolve(import.meta.dirname, "../.."),
  target = getCsfIsolatedSupabaseEnv,
  run = spawnSync,
} = {}) {
  const { dbUrl } = target();
  const query = isolatedReleaseCatalogQuery(
    `SELECT coalesce(json_agg(row), '[]'::json) FROM (${finalSchemaInventory}) row;`,
  );
  const result = run(
    "psql",
    [dbUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-At"],
    {
      input: query,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 60_000,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  if (result.error || result.status !== 0)
    throw new Error("The owned isolated inventory query failed.");
  let objects;
  try {
    objects = JSON.parse(result.stdout);
  } catch {
    throw new Error("The isolated inventory is not valid JSON.");
  }
  if (
    !Array.isArray(objects) ||
    objects.length === 0 ||
    objects.some(
      (row) =>
        !row ||
        typeof row !== "object" ||
        Object.keys(row).sort().join(",") !== "digest,identity" ||
        typeof row.identity !== "string" ||
        typeof row.digest !== "string" ||
        !/^[a-f0-9]{32}$/u.test(row.digest),
    ) ||
    new Set(objects.map((row) => row.identity)).size !== objects.length
  )
    throw new Error("The isolated inventory has an invalid metadata shape.");
  assertCleanInventory(objects);
  return generateFinalSchemaManifest(expectedVersions(cwd), objects);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    process.stdout.write(
      `${JSON.stringify(captureIsolatedReleaseInventory(), null, 2)}\n`,
    );
  } catch {
    console.error("Owned isolated schema inventory capture failed.");
    process.exitCode = 1;
  }
}
