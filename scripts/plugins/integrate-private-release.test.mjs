import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  integratePrivateRelease,
  nextMigrationVersion,
} from "./integrate-private-release.mjs";

const temporaryRoots = [];
const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function runGit(repository, ...args) {
  return execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
  }).trim();
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "root-plugin-integration-"));
  temporaryRoots.push(root);
  const privateRoot = join(root, "private");
  const artifacts = join(root, "artifacts");
  const migrationsDir = join(root, "migrations");
  const pluginRoot = join(privateRoot, "plugins/example-plugin");
  mkdirSync(pluginRoot, { recursive: true });
  mkdirSync(artifacts, { recursive: true });
  mkdirSync(migrationsDir, { recursive: true });
  writeFileSync(
    join(pluginRoot, "plugin.ts"),
    'export const plugin = {\n  version: "1.2.3",\n};\n',
  );
  writeFileSync(
    join(pluginRoot, "CHANGELOG.md"),
    "# Changelog\n\n## 1.2.3 - 2026-08-20\n\n- Signed update.\n\n## 1.2.2\n\n- Previous.\n",
  );
  writeFileSync(
    join(pluginRoot, "feature.ts"),
    'export const value = "new";\n',
  );
  runGit(privateRoot, "init", "-b", "main");
  runGit(privateRoot, "config", "user.name", "Integration Test");
  runGit(privateRoot, "config", "user.email", "integration@local.test");
  runGit(privateRoot, "add", ".");
  runGit(privateRoot, "commit", "-m", "release");
  const sourceCommit = runGit(privateRoot, "rev-parse", "HEAD");
  const sourceTree = runGit(
    privateRoot,
    "rev-parse",
    "HEAD:plugins/example-plugin",
  );
  const output = execFileSync(
    "git",
    [
      "ls-tree",
      "-r",
      "-z",
      "--full-tree",
      sourceCommit,
      "--",
      "plugins/example-plugin",
    ],
    { cwd: privateRoot },
  );
  const files = output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const [header, path] = record.split("\t");
      const [mode, , object] = header.split(" ");
      const bytes = execFileSync("git", ["cat-file", "blob", object], {
        cwd: privateRoot,
      });
      return { path, mode, size: bytes.length, digest: digest(bytes) };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  const canonical = files.map((file) =>
    Buffer.from(
      `${file.mode}\0${file.path}\0${file.digest}\0${file.size}\n`,
      "utf8",
    ),
  );
  const sbomPath = join(artifacts, "release.cdx.json");
  writeFileSync(sbomPath, '{"bomFormat":"CycloneDX","specVersion":"1.6"}\n');
  const manifest = {
    schemaVersion: 1,
    pluginKey: "example-plugin",
    version: "1.2.3",
    tag: "example-plugin/v1.2.3",
    runtimeProfile: "embedded",
    sourceCommit,
    sourceCommitTime: "2026-08-20T00:00:00Z",
    sourceTree,
    contentDigest: digest(Buffer.concat(canonical)),
    manifestPath: "plugins/example-plugin/plugin.ts",
    manifestDigest: files.find((file) => file.path.endsWith("plugin.ts"))
      .digest,
    changelogPath: "plugins/example-plugin/CHANGELOG.md",
    changelogDigest: files.find((file) => file.path.endsWith("CHANGELOG.md"))
      .digest,
    releaseInputs: ["plugins/example-plugin"],
    fileCount: files.length,
    files,
    buildDigest: null,
    sbomDigest: digest(readFileSync(sbomPath)),
    signerIdentity: {
      issuer: "https://token.actions.githubusercontent.com",
      subject:
        "https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/example-plugin/v1.2.3",
    },
    hostApiRange: { minimum: "1.0.0" },
    pluginDataSchemaVersion: 1,
    requiredPlatformSchemaVersion: "20260412000001",
    supportedInstallContracts: { minimum: "1.2.2", maximum: "1.2.3" },
  };
  const manifestPath = join(artifacts, "release-manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const registryPath = join(root, "published-releases.json");
  writeFileSync(
    registryPath,
    `${JSON.stringify(
      [
        {
          pluginKey: "example-plugin",
          version: "1.2.2",
          manifestFile: "plugins/example-plugin/plugin.ts",
          manifestHash: "a".repeat(64),
          sourceCommit,
          automaticUpdate: false,
          rolloutPercentage: 0,
          runtimeProfile: "embedded",
          sourceTree: null,
          contentDigest: null,
          releaseInputs: null,
          buildDigest: null,
          sbomDigest: null,
          signer: null,
          hostApiRange: { minimum: "1.0.0", maximum: "1.0.0" },
          pluginDataSchemaVersion: 1,
          requiredPlatformSchemaVersion: "legacy",
          supportedInstallContracts: { minimum: "1.2.2", maximum: "1.2.2" },
        },
      ],
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(migrationsDir, "20260412000001_existing.sql"),
    "-- existing contract\n",
  );
  return {
    root,
    privateRoot,
    artifacts,
    migrationsDir,
    registryPath,
    manifestPath,
    sbomPath,
    manifest,
  };
}

function integrate(input) {
  return integratePrivateRelease({
    manifestPath: input.manifestPath,
    sbomPath: input.sbomPath,
    privateRoot: input.privateRoot,
    registryPath: input.registryPath,
    migrationsDir: input.migrationsDir,
    migrationVersion: "20260820150000",
    attestationRef:
      "github-release:example-plugin/v1.2.3/release-manifest.sigstore.json",
  });
}

test("integrates an independently reconstructed signed release", () => {
  const input = fixture();
  const result = integrate(input);
  const registry = JSON.parse(readFileSync(input.registryPath, "utf8"));
  const migrationName = readdirSync(input.migrationsDir).find((file) =>
    file.startsWith("20260820150000_"),
  );
  const migration = readFileSync(
    join(input.migrationsDir, migrationName),
    "utf8",
  );

  assert.equal(result.version, "1.2.3");
  assert.equal(registry[0].sourceTree, input.manifest.sourceTree);
  assert.equal(registry[0].contentDigest, input.manifest.contentDigest);
  assert.equal(registry[0].signer.issuer, input.manifest.signerIdentity.issuer);
  assert.match(migration, /INSERT INTO public\.plugin_versions/u);
  assert.match(migration, /Signed update/u);
  assert.doesNotMatch(migration, /organization_plugin_installs/u);
});

test("refuses a signed inventory that does not match the private Git tree", () => {
  const input = fixture();
  const manifest = JSON.parse(readFileSync(input.manifestPath, "utf8"));
  manifest.files[0].digest = `sha256:${"0".repeat(64)}`;
  writeFileSync(input.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  assert.throws(() => integrate(input), /file inventory does not match/u);
});

test("refuses same-version replacement even when its signature is valid", () => {
  const input = fixture();
  const registry = JSON.parse(readFileSync(input.registryPath, "utf8"));
  registry[0].version = "1.2.3";
  writeFileSync(input.registryPath, `${JSON.stringify(registry, null, 2)}\n`);

  assert.throws(() => integrate(input), /must be newer/u);
});

test("places an automatic migration after an artificial future ledger head", () => {
  const input = fixture();
  writeFileSync(
    join(input.migrationsDir, "20260820190000_future_head.sql"),
    "-- artificial future head\n",
  );

  assert.equal(
    nextMigrationVersion(
      input.migrationsDir,
      new Date("2026-08-20T05:00:00.000Z"),
    ),
    "20260820190001",
  );
});

test("root workflow verifies known assets and opens only a Development PR", () => {
  const workflow = readFileSync(
    join(repositoryRoot, ".github/workflows/plugin-release-integration.yml"),
    "utf8",
  );
  for (const pin of [
    "actions/checkout@8e8c483db84b4bee98b60c0593521ed34d9990e8",
    "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
    "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
    "sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6",
  ]) {
    assert.match(workflow, new RegExp(pin, "u"));
  }
  assert.match(workflow, /cosign verify-blob/u);
  assert.match(workflow, /certificate-oidc-issuer/u);
  assert.match(workflow, /origin\/main/u);
  assert.match(workflow, /origin\/development/u);
  assert.match(workflow, /--base development/u);
  assert.match(workflow, /--migration-version auto/u);
  assert.doesNotMatch(workflow, /gh release download "\$\{.*AssetUrl/u);
  assert.doesNotMatch(workflow, /--base main/u);
});
