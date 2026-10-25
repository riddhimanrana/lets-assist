import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareVersions,
  preparePrivateReleaseIntegration,
  validateManifestShape,
  verifyPublishedEmbeddedTrees,
} from "./integrate-private-release.mjs";
import {
  buildBatchMigration,
  nextMigrationVersion,
} from "./private-release-publication.mjs";
import { prepareEmbeddedServingExpectations } from "./release-serving-contracts.mjs";

const fail = (message) => {
  throw new Error(message);
};
const repository = "riddhimanrana/lets-assist-plugins";
const git = (cwd, args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  }).trim();

function readReleases(releasesPath) {
  const releases = JSON.parse(readFileSync(releasesPath, "utf8"));
  if (!Array.isArray(releases) || releases.length < 2 || releases.length > 16)
    fail("a batch requires between two and sixteen embedded releases");
  const keys = ["bundlePath", "manifestPath", "sbomPath", "tag"];
  const rows = releases
    .map((entry) => {
      if (
        !entry ||
        typeof entry !== "object" ||
        JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(keys) ||
        Object.values(entry).some(
          (value) => typeof value !== "string" || !value,
        )
      )
        fail("batch release entries require exact tag and known asset paths");
      for (const field of ["manifestPath", "sbomPath", "bundlePath"])
        if (!existsSync(entry[field])) fail(`missing release asset: ${field}`);
      const manifest = JSON.parse(readFileSync(entry.manifestPath, "utf8"));
      validateManifestShape(manifest);
      if (manifest.runtimeProfile !== "embedded")
        fail("batch integration supports embedded releases only");
      if (entry.tag !== manifest.tag)
        fail("batch tag does not match its release manifest");
      return { ...entry, manifest };
    })
    .sort((a, b) => a.manifest.pluginKey.localeCompare(b.manifest.pluginKey));
  if (new Set(rows.map((row) => row.manifest.pluginKey)).size !== rows.length)
    fail("duplicate plugin in release batch");
  if (new Set(rows.map((row) => row.manifest.sourceCommit)).size !== 1)
    fail("batch releases must name the same exact private source commit");
  return rows;
}

// Inspection supplies a fixed-repository checkout ref, not verified evidence.
export function inspectPrivateReleaseBatch(releasesPath) {
  const rows = readReleases(releasesPath);
  return {
    sourceCommit: rows[0].manifest.sourceCommit,
    tags: rows.map((row) => row.tag),
    pluginKeys: rows.map((row) => row.manifest.pluginKey),
  };
}

export function integratePrivateReleaseBatch(
  {
    releasesPath,
    privateRoot,
    registryPath,
    migrationsDir,
    servingPrivateCommit,
  },
  { execute = execFileSync } = {},
) {
  const rows = readReleases(releasesPath);
  const sourceCommit = rows[0].manifest.sourceCommit;
  if (!/^[a-f0-9]{40}$/u.test(servingPrivateCommit ?? ""))
    fail("batch integration requires the exact serving private commit");
  if (git(privateRoot, ["status", "--porcelain"]))
    fail("private release checkout must be clean before integration");
  for (const row of rows) {
    try {
      execute(
        "cosign",
        [
          "verify-blob",
          "--bundle",
          resolve(row.bundlePath),
          "--certificate-identity",
          `https://github.com/${repository}/.github/workflows/plugin-release.yml@refs/tags/${row.tag}`,
          "--certificate-oidc-issuer",
          "https://token.actions.githubusercontent.com",
          resolve(row.manifestPath),
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 60_000,
          maxBuffer: 512 * 1024,
        },
      );
    } catch {
      fail(`signature verification failed for ${row.tag}`);
    }
    try {
      if (
        git(privateRoot, ["rev-parse", `refs/tags/${row.tag}^{commit}`]) !==
        sourceCommit
      )
        fail("tag moved");
      for (const branch of ["main", "development"])
        git(privateRoot, [
          "merge-base",
          "--is-ancestor",
          sourceCommit,
          `refs/remotes/origin/${branch}`,
        ]);
    } catch {
      fail(`release tag or promotion ancestry is invalid for ${row.tag}`);
    }
  }
  const migrationVersion = nextMigrationVersion(migrationsDir, new Date(0));
  const plans = rows.map((row) =>
    preparePrivateReleaseIntegration({
      manifestPath: row.manifestPath,
      sbomPath: row.sbomPath,
      privateRoot,
      registryPath,
      migrationsDir,
      migrationVersion,
      attestationRef: `github-release:${row.tag}/release-manifest.sigstore.json`,
      servingPrivateCommit,
    }),
  );
  const registry = structuredClone(plans[0].originalRegistry);
  for (const plan of plans) {
    const index = registry.findIndex(
      (entry) =>
        entry.pluginKey === plan.manifest.pluginKey &&
        entry.runtimeProfile === "embedded",
    );
    registry[index] = plan.nextRelease;
  }
  registry.sort(
    (a, b) =>
      a.pluginKey.localeCompare(b.pluginKey) ||
      compareVersions(a.version, b.version),
  );
  // Only independently verified releases may replace a published tree.
  verifyPublishedEmbeddedTrees(
    privateRoot,
    registry,
    sourceCommit,
    null,
    servingPrivateCommit,
  );
  const migrationPath = resolve(
    migrationsDir,
    `${migrationVersion}_publish_private_plugin_batch.sql`,
  );
  if (existsSync(migrationPath))
    fail("batch publication migration already exists");
  const updates = new Map();
  for (const plan of plans) {
    for (const [path, source] of prepareEmbeddedServingExpectations(
      resolve(migrationsDir, "../tests/database"),
      plan.manifest.pluginKey,
      plan.manifest.version,
      sourceCommit,
      updates,
    ))
      updates.set(path, source);
  }
  const migrationSql = buildBatchMigration(plans);
  const migrationTestPaths = [
    ...new Set([
      ...updates.keys(),
      ...plans.map((plan) => plan.summary.migrationTestPath),
    ]),
  ]
    .map((path) => resolve(path))
    .sort();
  // All signatures, source contracts, paths and serving expectations are checked
  // before the first mutation of the host registry, ledger or tests.
  git(privateRoot, ["checkout", "--detach", sourceCommit]);
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  writeFileSync(migrationPath, migrationSql);
  for (const [path, source] of updates) writeFileSync(path, source);
  for (const plan of plans)
    writeFileSync(plan.summary.migrationTestPath, plan.migrationTestSql);
  return {
    sourceCommit,
    migrationPath,
    migrationTestPaths,
    releases: plans.map((plan) => ({
      pluginKey: plan.manifest.pluginKey,
      version: plan.manifest.version,
      tag: plan.manifest.tag,
    })),
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 2) {
    const flag = process.argv[index],
      value = process.argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || args.has(flag))
      fail("arguments must be unique --name value pairs");
    args.set(flag, value);
  }
  const required =
    args.get("--mode") === "inspect"
      ? ["--mode", "--releases"]
      : [
          "--mode",
          "--releases",
          "--private-root",
          "--registry",
          "--migrations-dir",
          "--serving-private-commit",
        ];
  if (
    !["inspect", "integrate"].includes(args.get("--mode")) ||
    required.some((flag) => !args.has(flag)) ||
    args.size !== required.length
  )
    fail("invalid batch integration arguments");
  const result =
    args.get("--mode") === "inspect"
      ? inspectPrivateReleaseBatch(args.get("--releases"))
      : integratePrivateReleaseBatch({
          releasesPath: args.get("--releases"),
          privateRoot: resolve(args.get("--private-root")),
          registryPath: resolve(args.get("--registry")),
          migrationsDir: resolve(args.get("--migrations-dir")),
          servingPrivateCommit: args.get("--serving-private-commit"),
        });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
