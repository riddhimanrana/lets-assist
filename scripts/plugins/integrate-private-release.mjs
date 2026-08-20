import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
// The automatic integration lane accepts stable releases only. Supporting
// prereleases requires channel-aware ordering and install policy, neither of
// which this workflow claims to implement.
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MIGRATION_VERSION = /^\d{14}$/u;
const RELEASE_KEYS = [
  "buildDigest",
  "buildArtifact",
  "changelogDigest",
  "changelogPath",
  "contentDigest",
  "fileCount",
  "files",
  "hostApiRange",
  "manifestDigest",
  "manifestPath",
  "pluginDataSchemaVersion",
  "pluginKey",
  "releaseInputs",
  "requiredPlatformSchemaVersion",
  "runtimeProfile",
  "sbomDigest",
  "schemaVersion",
  "signerIdentity",
  "sourceCommit",
  "sourceCommitTime",
  "sourceTree",
  "supportedInstallContracts",
  "tag",
  "version",
].sort();

function fail(message) {
  throw new Error(message);
}

function git(repository, args, encoding = "utf8") {
  return execFileSync("git", args, {
    cwd: repository,
    encoding: encoding === null ? null : encoding,
    maxBuffer: 128 * 1024 * 1024,
  });
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...keys].sort())) {
    fail(`${label} contains unexpected or missing keys`);
  }
}

function assertRelativePath(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value
      .split("/")
      .some((part) => part === "" || part === "." || part === "..") ||
    posix.normalize(value) !== value
  ) {
    fail(`${label} must be a normalized repository-relative POSIX path`);
  }
}

function compareVersions(left, right) {
  const a = left.split(".").map((part) => Number.parseInt(part, 10));
  const b = right.split(".").map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function parseTreeRecord(record) {
  const tab = record.indexOf("\t");
  const header = record.slice(0, tab).split(" ");
  if (tab < 0 || header.length !== 3) fail("git ls-tree returned invalid data");
  return {
    mode: header[0],
    type: header[1],
    object: header[2],
    path: record.slice(tab + 1),
  };
}

function listReleaseFiles(privateRoot, manifest) {
  const output = git(
    privateRoot,
    [
      "ls-tree",
      "-r",
      "-z",
      "--full-tree",
      manifest.sourceCommit,
      "--",
      ...manifest.releaseInputs,
    ],
    null,
  );
  const records = output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map(parseTreeRecord)
    .sort((left, right) => left.path.localeCompare(right.path));
  if (records.length === 0) fail("release inputs contain no tracked files");
  return records;
}

function validateManifestShape(manifest) {
  assertExactKeys(manifest, RELEASE_KEYS, "release manifest");
  if (![1, 2].includes(manifest.schemaVersion))
    fail("unsupported release schema version");
  if (!PLUGIN_KEY.test(manifest.pluginKey)) fail("invalid plugin key");
  if (!SEMVER.test(manifest.version)) fail("invalid plugin version");
  if (manifest.tag !== `${manifest.pluginKey}/v${manifest.version}`) {
    fail("release tag does not match plugin identity");
  }
  if (
    !GIT_SHA.test(manifest.sourceCommit) ||
    !GIT_SHA.test(manifest.sourceTree)
  ) {
    fail("release source commit and tree must be Git object ids");
  }
  for (const [label, value] of [
    ["content digest", manifest.contentDigest],
    ["manifest digest", manifest.manifestDigest],
    ["changelog digest", manifest.changelogDigest],
    ["SBOM digest", manifest.sbomDigest],
  ]) {
    if (!SHA256.test(value)) fail(`${label} must be a SHA-256 digest`);
  }
  if (!["embedded", "application", "service"].includes(manifest.runtimeProfile))
    fail("unsupported runtime profile");
  if (manifest.runtimeProfile === "service")
    fail("automatic root integration does not support service releases yet");
  if (
    manifest.runtimeProfile === "embedded" &&
    (manifest.buildDigest !== null || manifest.buildArtifact !== null)
  )
    fail("an embedded release cannot claim an independent build artifact");
  if (manifest.runtimeProfile === "application") {
    const artifact = manifest.buildArtifact;
    if (
      manifest.schemaVersion !== 2 ||
      !SHA256.test(manifest.buildDigest) ||
      !artifact ||
      Object.keys(artifact).sort().join(",") !==
        "format,name,organizationId,projectId,projectName,root" ||
      artifact.name !== "plugin-build.tar.gz" ||
      artifact.format !== "vercel-prebuilt-v1" ||
      !PLUGIN_KEY.test(artifact.projectName) ||
      !/^prj_[A-Za-z0-9]+$/u.test(artifact.projectId) ||
      !/^team_[A-Za-z0-9]+$/u.test(artifact.organizationId)
    )
      fail("invalid application build artifact contract");
    assertRelativePath(artifact.root, "application build root");
  }
  if (
    !Array.isArray(manifest.releaseInputs) ||
    manifest.releaseInputs.length === 0
  ) {
    fail("release inputs are required");
  }
  for (const [index, input] of manifest.releaseInputs.entries()) {
    assertRelativePath(input, `release input ${index}`);
  }
  if (new Set(manifest.releaseInputs).size !== manifest.releaseInputs.length) {
    fail("release inputs contain duplicates");
  }
  const pluginRoot = `plugins/${manifest.pluginKey}`;
  if (!manifest.releaseInputs.includes(pluginRoot)) {
    fail(`release inputs must include exact ${pluginRoot}`);
  }
  if (
    manifest.runtimeProfile === "embedded" &&
    (manifest.releaseInputs.length !== 1 ||
      manifest.releaseInputs[0] !== pluginRoot)
  ) {
    fail("embedded releases must cover exactly their plugin subtree");
  }
  for (const [label, value] of [
    ["manifest path", manifest.manifestPath],
    ["changelog path", manifest.changelogPath],
  ]) {
    assertRelativePath(value, label);
  }
  if (!manifest.changelogPath.startsWith(`${pluginRoot}/`))
    fail("changelog path must belong to the plugin");
  if (
    manifest.runtimeProfile === "embedded" &&
    !manifest.manifestPath.startsWith(`${pluginRoot}/`)
  )
    fail("embedded manifest path must belong to the plugin");
  if (
    manifest.runtimeProfile === "application" &&
    (!manifest.releaseInputs.includes(manifest.buildArtifact.root) ||
      !manifest.manifestPath.startsWith(`${manifest.buildArtifact.root}/`))
  )
    fail("application release inputs do not cover the build root and manifest");
  if (
    !manifest.hostApiRange ||
    !SEMVER.test(manifest.hostApiRange.minimum) ||
    (manifest.hostApiRange.maximum !== undefined &&
      !SEMVER.test(manifest.hostApiRange.maximum))
  ) {
    fail("invalid host API range");
  }
  const contracts = manifest.supportedInstallContracts;
  if (
    !contracts ||
    !SEMVER.test(contracts.minimum) ||
    !SEMVER.test(contracts.maximum) ||
    compareVersions(contracts.minimum, contracts.maximum) > 0 ||
    contracts.maximum !== manifest.version
  ) {
    fail("invalid supported install contract range");
  }
  if (
    !Number.isInteger(manifest.pluginDataSchemaVersion) ||
    manifest.pluginDataSchemaVersion < 1
  ) {
    fail("invalid plugin data schema version");
  }
  if (!MIGRATION_VERSION.test(manifest.requiredPlatformSchemaVersion)) {
    fail("required platform schema version must name a migration contract");
  }
  const expectedSubject = `https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/${manifest.tag}`;
  if (
    manifest.signerIdentity?.issuer !==
      "https://token.actions.githubusercontent.com" ||
    manifest.signerIdentity?.subject !== expectedSubject
  ) {
    fail("release signer identity does not match the private release workflow");
  }
}

function verifyReleaseBytes(privateRoot, manifest, sbomPath, buildPath) {
  const sourceTree = git(privateRoot, [
    "rev-parse",
    `${manifest.sourceCommit}:plugins/${manifest.pluginKey}`,
  ]).trim();
  if (sourceTree !== manifest.sourceTree)
    fail("plugin source tree does not match Git");

  const records = listReleaseFiles(privateRoot, manifest);
  const details = [];
  const canonicalParts = [];
  for (const entry of records) {
    if (entry.type !== "blob" || entry.mode === "120000") {
      fail(`release input ${entry.path} is not a regular tracked file`);
    }
    const bytes = git(privateRoot, ["cat-file", "blob", entry.object], null);
    const digest = sha256(bytes);
    details.push({
      path: entry.path,
      mode: entry.mode,
      size: bytes.length,
      digest,
    });
    canonicalParts.push(
      Buffer.from(
        `${entry.mode}\0${entry.path}\0${digest}\0${bytes.length}\n`,
        "utf8",
      ),
    );
  }
  if (
    manifest.fileCount !== details.length ||
    JSON.stringify(manifest.files) !== JSON.stringify(details)
  ) {
    fail("signed file inventory does not match the private Git tree");
  }
  if (sha256(Buffer.concat(canonicalParts)) !== manifest.contentDigest) {
    fail("content digest does not match the declared release inputs");
  }
  const byPath = new Map(details.map((detail) => [detail.path, detail]));
  if (byPath.get(manifest.manifestPath)?.digest !== manifest.manifestDigest) {
    fail("plugin manifest digest does not match the signed inventory");
  }
  if (byPath.get(manifest.changelogPath)?.digest !== manifest.changelogDigest) {
    fail("plugin changelog digest does not match the signed inventory");
  }
  if (sha256(readFileSync(sbomPath)) !== manifest.sbomDigest) {
    fail("SBOM bytes do not match the signed digest");
  }
  if (manifest.runtimeProfile === "application") {
    if (!buildPath || !existsSync(buildPath))
      fail("application build artifact is missing");
    if (sha256(readFileSync(buildPath)) !== manifest.buildDigest)
      fail("application build artifact does not match the signed digest");
  } else if (buildPath) {
    fail("embedded release supplied an unexpected build artifact");
  }
  const manifestSource = git(
    privateRoot,
    ["show", `${manifest.sourceCommit}:${manifest.manifestPath}`],
    "utf8",
  );
  const versions = [...manifestSource.matchAll(/^\s*version:\s*"([^"]+)"/gmu)];
  if (versions.length !== 1 || versions[0][1] !== manifest.version) {
    fail("runtime manifest version does not match the release version");
  }
}

function extractReleaseNotes(privateRoot, manifest) {
  const changelog = git(
    privateRoot,
    ["show", `${manifest.sourceCommit}:${manifest.changelogPath}`],
    "utf8",
  );
  const escaped = manifest.version.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const heading = new RegExp(`^## \\[?${escaped}\\]?(?: - .+)?$`, "mu");
  const match = heading.exec(changelog);
  if (!match) fail("signed changelog has no section for the release version");
  const remaining = changelog.slice(match.index + match[0].length);
  const next = /^## /mu.exec(remaining);
  return changelog
    .slice(
      match.index,
      next ? match.index + match[0].length + next.index : undefined,
    )
    .trim()
    .concat("\n");
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value))}::jsonb`;
}

function formatMigrationDate(date) {
  const part = (value) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${part(date.getUTCMonth() + 1)}${part(date.getUTCDate())}${part(date.getUTCHours())}${part(date.getUTCMinutes())}${part(date.getUTCSeconds())}`;
}

function parseMigrationDate(value) {
  if (!MIGRATION_VERSION.test(value))
    fail("invalid migration ledger timestamp");
  const date = new Date(
    Date.UTC(
      Number.parseInt(value.slice(0, 4), 10),
      Number.parseInt(value.slice(4, 6), 10) - 1,
      Number.parseInt(value.slice(6, 8), 10),
      Number.parseInt(value.slice(8, 10), 10),
      Number.parseInt(value.slice(10, 12), 10),
      Number.parseInt(value.slice(12, 14), 10),
    ),
  );
  if (formatMigrationDate(date) !== value)
    fail("invalid migration ledger date");
  return date;
}

export function nextMigrationVersion(migrationsDir, now = new Date()) {
  const versions = readdirSync(migrationsDir)
    .map((file) => /^(\d{14})_/u.exec(file)?.[1])
    .filter(Boolean)
    .sort();
  const latest = versions.at(-1);
  if (!latest) return formatMigrationDate(now);
  const afterLatest = new Date(parseMigrationDate(latest).getTime() + 1000);
  return formatMigrationDate(afterLatest > now ? afterLatest : now);
}

function buildMigration(
  manifest,
  releaseNotes,
  previousVersion,
  attestationRef,
) {
  const manifestHash = manifest.manifestDigest.slice("sha256:".length);
  const signer = {
    identity: manifest.signerIdentity.subject,
    issuer: manifest.signerIdentity.issuer,
    attestationRef,
  };
  const compatibility = { host: "lets-assist", automaticUpdate: false };
  return `-- Publish a signed private plugin release without changing organization installs.\n\nBEGIN;\n\nDO $$\nDECLARE\n  v_existing public.plugin_versions%ROWTYPE;\nBEGIN\n  SELECT * INTO v_existing\n  FROM public.plugin_versions\n  WHERE plugin_key = ${sqlString(manifest.pluginKey)}\n    AND version = ${sqlString(manifest.version)};\n\n  IF FOUND THEN\n    IF v_existing.status IS DISTINCT FROM 'published'\n      OR v_existing.commit_sha IS DISTINCT FROM ${sqlString(manifest.sourceCommit)}\n      OR v_existing.manifest_hash IS DISTINCT FROM ${sqlString(manifestHash)}\n      OR v_existing.source_tree IS DISTINCT FROM ${sqlString(manifest.sourceTree)}\n      OR v_existing.content_digest IS DISTINCT FROM ${sqlString(manifest.contentDigest)}\n      OR v_existing.release_inputs IS DISTINCT FROM ${sqlJson(manifest.releaseInputs)}\n      OR v_existing.build_digest IS DISTINCT FROM ${manifest.buildDigest === null ? "NULL" : sqlString(manifest.buildDigest)}\n      OR v_existing.sbom_digest IS DISTINCT FROM ${sqlString(manifest.sbomDigest)}\n      OR v_existing.signer_identity IS DISTINCT FROM ${sqlJson(signer)}\n      OR v_existing.host_api_range IS DISTINCT FROM ${sqlJson(manifest.hostApiRange)}\n      OR v_existing.plugin_data_schema_version IS DISTINCT FROM ${manifest.pluginDataSchemaVersion}\n      OR v_existing.required_platform_schema_version IS DISTINCT FROM ${sqlString(manifest.requiredPlatformSchemaVersion)}\n      OR v_existing.supported_install_contracts IS DISTINCT FROM ${sqlJson(manifest.supportedInstallContracts)}\n      OR v_existing.runtime_profile IS DISTINCT FROM ${sqlString(manifest.runtimeProfile)}\n      OR v_existing.rollout_percentage IS DISTINCT FROM 0\n    THEN\n      RAISE EXCEPTION 'Existing plugin release conflicts with the signed release identity';\n    END IF;\n  ELSE\n    INSERT INTO public.plugin_versions (\n      plugin_key, version, status, changelog, commit_sha, manifest_hash,\n      compatibility_contract, rollout_percentage, source_tree, content_digest,\n      release_inputs, build_digest, sbom_digest, signer_identity, host_api_range,\n      plugin_data_schema_version, required_platform_schema_version,\n      supported_install_contracts, runtime_profile, published_at\n    ) VALUES (\n      ${sqlString(manifest.pluginKey)},\n      ${sqlString(manifest.version)},\n      'published',\n      ${sqlString(releaseNotes)},\n      ${sqlString(manifest.sourceCommit)},\n      ${sqlString(manifestHash)},\n      ${sqlJson(compatibility)},\n      0,\n      ${sqlString(manifest.sourceTree)},\n      ${sqlString(manifest.contentDigest)},\n      ${sqlJson(manifest.releaseInputs)},\n      ${manifest.buildDigest === null ? "NULL" : sqlString(manifest.buildDigest)},\n      ${sqlString(manifest.sbomDigest)},\n      ${sqlJson(signer)},\n      ${sqlJson(manifest.hostApiRange)},\n      ${manifest.pluginDataSchemaVersion},\n      ${sqlString(manifest.requiredPlatformSchemaVersion)},\n      ${sqlJson(manifest.supportedInstallContracts)},\n      ${sqlString(manifest.runtimeProfile)},\n      now()\n    );\n  END IF;\n\n  UPDATE public.plugins\n  SET latest_version = ${sqlString(manifest.version)},\n      code_reference = ${sqlString(manifest.sourceCommit)},\n      updated_at = now()\n  WHERE key = ${sqlString(manifest.pluginKey)}\n    AND latest_version = ${sqlString(previousVersion)};\n\n  IF NOT FOUND AND NOT EXISTS (\n    SELECT 1 FROM public.plugins\n    WHERE key = ${sqlString(manifest.pluginKey)}\n      AND latest_version = ${sqlString(manifest.version)}\n      AND code_reference = ${sqlString(manifest.sourceCommit)}\n  ) THEN\n    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';\n  END IF;\nEND;\n$$;\n\nCOMMIT;\n`;
}

function buildMigrationTest(manifest) {
  const manifestHash = manifest.manifestDigest.slice("sha256:".length);
  return `BEGIN;\n\nSELECT plan(8);\n\nSELECT is(\n  (SELECT status::text FROM public.plugin_versions WHERE plugin_key = ${sqlString(manifest.pluginKey)} AND version = ${sqlString(manifest.version)}),\n  'published',\n  'signed plugin release is published'\n);\n\nSELECT is(\n  (SELECT commit_sha FROM public.plugin_versions WHERE plugin_key = ${sqlString(manifest.pluginKey)} AND version = ${sqlString(manifest.version)}),\n  ${sqlString(manifest.sourceCommit)},\n  'signed source commit is recorded'\n);\n\nSELECT is(\n  (SELECT manifest_hash FROM public.plugin_versions WHERE plugin_key = ${sqlString(manifest.pluginKey)} AND version = ${sqlString(manifest.version)}),\n  ${sqlString(manifestHash)},\n  'signed manifest hash is recorded'\n);\n\nSELECT is(\n  (SELECT source_tree FROM public.plugin_versions WHERE plugin_key = ${sqlString(manifest.pluginKey)} AND version = ${sqlString(manifest.version)}),\n  ${sqlString(manifest.sourceTree)},\n  'signed source tree is recorded'\n);\n\nSELECT is(\n  (SELECT content_digest FROM public.plugin_versions WHERE plugin_key = ${sqlString(manifest.pluginKey)} AND version = ${sqlString(manifest.version)}),\n  ${sqlString(manifest.contentDigest)},\n  'signed content digest is recorded'\n);\n\nSELECT is(\n  (SELECT supported_install_contracts FROM public.plugin_versions WHERE plugin_key = ${sqlString(manifest.pluginKey)} AND version = ${sqlString(manifest.version)}),\n  ${sqlJson(manifest.supportedInstallContracts)},\n  'install compatibility range is recorded'\n);\n\nSELECT is(\n  (SELECT latest_version FROM public.plugins WHERE key = ${sqlString(manifest.pluginKey)}),\n  ${sqlString(manifest.version)},\n  'plugin catalog points at the signed release'\n);\n\nSELECT is(\n  (SELECT code_reference FROM public.plugins WHERE key = ${sqlString(manifest.pluginKey)}),\n  ${sqlString(manifest.sourceCommit)},\n  'plugin catalog points at the signed source commit'\n);\n\nSELECT * FROM finish();\nROLLBACK;\n`;
}

export function integratePrivateRelease({
  manifestPath,
  sbomPath,
  buildPath,
  privateRoot,
  registryPath,
  migrationsDir,
  migrationVersion,
  attestationRef,
}) {
  const resolvedMigrationVersion =
    migrationVersion === "auto"
      ? nextMigrationVersion(migrationsDir)
      : migrationVersion;
  if (!MIGRATION_VERSION.test(resolvedMigrationVersion)) {
    fail("migration version must contain 14 digits");
  }
  const latestMigration = readdirSync(migrationsDir)
    .map((file) => /^(\d{14})_/u.exec(file)?.[1])
    .filter(Boolean)
    .sort()
    .at(-1);
  if (latestMigration && resolvedMigrationVersion <= latestMigration) {
    fail("new migration version must be later than the current ledger head");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  validateManifestShape(manifest);
  verifyReleaseBytes(privateRoot, manifest, sbomPath, buildPath);
  if (
    !readdirSync(migrationsDir).some((file) =>
      file.startsWith(`${manifest.requiredPlatformSchemaVersion}_`),
    )
  ) {
    fail(
      "required platform schema migration is not present in the root ledger",
    );
  }

  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  if (!Array.isArray(registry))
    fail("published release registry must be an array");
  const pluginReleases = registry.filter(
    (entry) => entry.pluginKey === manifest.pluginKey,
  );
  if (pluginReleases.length === 0)
    fail("release plugin is absent from the root runtime registry");
  const previous = pluginReleases.sort((left, right) =>
    compareVersions(right.version, left.version),
  )[0];
  if (compareVersions(manifest.version, previous.version) <= 0) {
    fail(
      "signed release version must be newer than the published runtime release",
    );
  }
  try {
    git(privateRoot, [
      "merge-base",
      "--is-ancestor",
      previous.sourceCommit,
      manifest.sourceCommit,
    ]);
  } catch {
    fail(
      "signed release source must descend from the published runtime source",
    );
  }
  if (
    compareVersions(
      previous.version,
      manifest.supportedInstallContracts.minimum,
    ) < 0
  ) {
    fail(
      "new plugin code would exclude the currently published install contract",
    );
  }

  const releaseNotes = extractReleaseNotes(privateRoot, manifest);
  const nextRelease = {
    pluginKey: manifest.pluginKey,
    version: manifest.version,
    manifestFile: manifest.manifestPath,
    manifestHash: manifest.manifestDigest.slice("sha256:".length),
    sourceCommit: manifest.sourceCommit,
    automaticUpdate: false,
    rolloutPercentage: 0,
    runtimeProfile: manifest.runtimeProfile,
    sourceTree: manifest.sourceTree,
    contentDigest: manifest.contentDigest,
    releaseInputs: manifest.releaseInputs,
    buildDigest: manifest.buildDigest,
    buildArtifact: manifest.buildArtifact,
    sbomDigest: manifest.sbomDigest,
    signer: {
      identity: manifest.signerIdentity.subject,
      issuer: manifest.signerIdentity.issuer,
      attestationRef,
    },
    hostApiRange: manifest.hostApiRange,
    pluginDataSchemaVersion: manifest.pluginDataSchemaVersion,
    requiredPlatformSchemaVersion: manifest.requiredPlatformSchemaVersion,
    supportedInstallContracts: manifest.supportedInstallContracts,
  };
  const profileIndex = registry.findIndex(
    (entry) =>
      entry.pluginKey === manifest.pluginKey &&
      entry.runtimeProfile === manifest.runtimeProfile,
  );
  if (profileIndex >= 0) registry[profileIndex] = nextRelease;
  else registry.push(nextRelease);
  registry.sort(
    (left, right) =>
      left.pluginKey.localeCompare(right.pluginKey) ||
      compareVersions(left.version, right.version),
  );

  const migrationPath = join(
    migrationsDir,
    `${resolvedMigrationVersion}_publish_${manifest.pluginKey.replaceAll("-", "_")}_${manifest.version.replaceAll(".", "_")}.sql`,
  );
  if (existsSync(migrationPath))
    fail(`migration already exists: ${basename(migrationPath)}`);
  const migrationTestPath = join(
    resolve(migrationsDir, "../tests/database"),
    `plugin_release_${manifest.pluginKey.replaceAll("-", "_")}_${manifest.version.replaceAll(".", "_")}.test.sql`,
  );
  if (existsSync(migrationTestPath)) {
    fail(`migration test already exists: ${basename(migrationTestPath)}`);
  }
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  writeFileSync(
    migrationPath,
    buildMigration(manifest, releaseNotes, previous.version, attestationRef),
  );
  writeFileSync(migrationTestPath, buildMigrationTest(manifest));
  git(privateRoot, ["checkout", "--detach", manifest.sourceCommit]);

  return {
    pluginKey: manifest.pluginKey,
    version: manifest.version,
    previousVersion: previous.version,
    sourceCommit: manifest.sourceCommit,
    migrationPath: resolve(migrationPath),
    migrationTestPath: resolve(migrationTestPath),
  };
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      fail("arguments must be --name value pairs");
    }
    if (values.has(flag)) fail(`duplicate argument ${flag}`);
    values.set(flag, value);
  }
  return values;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  const args = parseArguments(process.argv.slice(2));
  const required = [
    "--manifest",
    "--sbom",
    "--private-root",
    "--registry",
    "--migrations-dir",
    "--migration-version",
    "--attestation-ref",
  ];
  for (const flag of required) if (!args.has(flag)) fail(`missing ${flag}`);
  const result = integratePrivateRelease({
    manifestPath: resolve(args.get("--manifest")),
    sbomPath: resolve(args.get("--sbom")),
    buildPath: args.get("--build") ? resolve(args.get("--build")) : undefined,
    privateRoot: resolve(args.get("--private-root")),
    registryPath: resolve(args.get("--registry")),
    migrationsDir: resolve(args.get("--migrations-dir")),
    migrationVersion: args.get("--migration-version"),
    attestationRef: args.get("--attestation-ref"),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
