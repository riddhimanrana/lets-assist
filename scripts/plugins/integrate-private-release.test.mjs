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

function fixture({
  application = false,
  priorApplication = false,
  multiEnvironment = false,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "root-plugin-integration-"));
  temporaryRoots.push(root);
  const privateRoot = join(root, "private");
  const artifacts = join(root, "artifacts");
  const migrationsDir = join(root, "migrations");
  const migrationTestsDir = join(root, "tests/database");
  const pluginRoot = join(privateRoot, "plugins/example-plugin");
  const applicationRoot = join(privateRoot, "apps/example");
  mkdirSync(pluginRoot, { recursive: true });
  if (application) mkdirSync(join(applicationRoot, "lib"), { recursive: true });
  mkdirSync(artifacts, { recursive: true });
  mkdirSync(migrationsDir, { recursive: true });
  mkdirSync(migrationTestsDir, { recursive: true });
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
  if (application) {
    writeFileSync(
      join(applicationRoot, "lib/manifest.ts"),
      'export const manifest = {\n  version: "1.2.3",\n};\n',
    );
    writeFileSync(
      join(applicationRoot, "package.json"),
      '{"name":"example-app","version":"1.2.3"}\n',
    );
    writeFileSync(join(applicationRoot, "bun.lock"), "lockfileVersion = 1\n");
  }
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
  const releaseInputs = application
    ? ["plugins/example-plugin", "apps/example"]
    : ["plugins/example-plugin"];
  const output = execFileSync(
    "git",
    [
      "ls-tree",
      "-r",
      "-z",
      "--full-tree",
      sourceCommit,
      "--",
      ...releaseInputs,
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
  const buildPath = application
    ? join(artifacts, "plugin-build.tar.gz")
    : undefined;
  const buildPaths = multiEnvironment
    ? {
        development: join(artifacts, "plugin-build-development.tar.gz"),
        production: join(artifacts, "plugin-build-production.tar.gz"),
      }
    : undefined;
  if (buildPaths) {
    writeFileSync(buildPaths.development, "Development Vercel bytes\n");
    writeFileSync(buildPaths.production, "Production Vercel bytes\n");
  } else if (buildPath) {
    writeFileSync(buildPath, "exact Vercel prebuilt bytes\n");
  }
  const environmentArtifacts = buildPaths
    ? {
        development: {
          name: "plugin-build-development.tar.gz",
          digest: digest(readFileSync(buildPaths.development)),
        },
        production: {
          name: "plugin-build-production.tar.gz",
          digest: digest(readFileSync(buildPaths.production)),
        },
      }
    : undefined;
  const manifestPathInSource = application
    ? "apps/example/lib/manifest.ts"
    : "plugins/example-plugin/plugin.ts";
  const manifest = {
    schemaVersion: multiEnvironment ? 3 : application ? 2 : 1,
    pluginKey: "example-plugin",
    version: "1.2.3",
    tag: "example-plugin/v1.2.3",
    runtimeProfile: application ? "application" : "embedded",
    sourceCommit,
    sourceCommitTime: "2026-08-20T00:00:00Z",
    sourceTree,
    contentDigest: digest(Buffer.concat(canonical)),
    manifestPath: manifestPathInSource,
    manifestDigest: files.find((file) => file.path === manifestPathInSource)
      .digest,
    changelogPath: "plugins/example-plugin/CHANGELOG.md",
    changelogDigest: files.find((file) => file.path.endsWith("CHANGELOG.md"))
      .digest,
    releaseInputs,
    fileCount: files.length,
    files,
    buildArtifact: application
      ? multiEnvironment
        ? {
            format: "vercel-prebuilt-multi-env-v1",
            root: "apps/example",
            projectName: "example-app",
            projectId: "prj_example",
            organizationId: "team_example",
            artifacts: environmentArtifacts,
          }
        : {
            name: "plugin-build.tar.gz",
            format: "vercel-prebuilt-v1",
            root: "apps/example",
            projectName: "example-app",
            projectId: "prj_example",
            organizationId: "team_example",
          }
      : null,
    buildDigest: buildPaths
      ? digest(Buffer.from(JSON.stringify(environmentArtifacts), "utf8"))
      : buildPath
        ? digest(readFileSync(buildPath))
        : null,
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
  const applicationTargetsPath = join(
    root,
    "application-deployment-targets.json",
  );
  writeFileSync(
    applicationTargetsPath,
    `${JSON.stringify(
      {
        "example-plugin": {
          root: "apps/example",
          routingApplication: "example-app",
          projectName: "example-app",
          projectId: "prj_example",
          organizationId: "team_example",
        },
      },
      null,
      2,
    )}\n`,
  );
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
          buildArtifact: null,
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
  if (priorApplication) {
    const releases = JSON.parse(readFileSync(registryPath, "utf8"));
    releases[0].version = "1.2.1";
    releases[0].supportedInstallContracts = {
      minimum: "1.2.1",
      maximum: "1.2.1",
    };
    releases.push({
      ...releases[0],
      version: "1.2.2",
      runtimeProfile: "application",
      buildDigest: `sha256:${"9".repeat(64)}`,
      buildArtifact: {
        name: "plugin-build.tar.gz",
        format: "vercel-prebuilt-v1",
        root: "apps/example",
        projectName: "example-app",
        projectId: "prj_example",
        organizationId: "team_example",
      },
      supportedInstallContracts: {
        minimum: "1.2.1",
        maximum: "1.2.2",
      },
    });
    writeFileSync(registryPath, `${JSON.stringify(releases, null, 2)}\n`);
  }
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
    applicationTargetsPath,
    manifestPath,
    sbomPath,
    buildPath,
    buildPaths,
    manifest,
  };
}

function integrate(input) {
  return integratePrivateRelease({
    manifestPath: input.manifestPath,
    sbomPath: input.sbomPath,
    buildPath: input.buildPath,
    buildPaths: input.buildPaths,
    privateRoot: input.privateRoot,
    registryPath: input.registryPath,
    applicationTargetsPath: input.applicationTargetsPath,
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
  const migrationTestName = readdirSync(
    join(input.root, "tests/database"),
  ).find((file) => file.includes("example_plugin_1_2_3"));
  const migrationTest = readFileSync(
    join(input.root, "tests/database", migrationTestName),
    "utf8",
  );

  assert.equal(result.version, "1.2.3");
  assert.equal(registry[0].sourceTree, input.manifest.sourceTree);
  assert.equal(registry[0].contentDigest, input.manifest.contentDigest);
  assert.equal(registry[0].signer.issuer, input.manifest.signerIdentity.issuer);
  assert.match(migration, /INSERT INTO public\.plugin_versions/u);
  assert.match(migration, /Signed update/u);
  assert.doesNotMatch(migration, /organization_plugin_installs/u);
  assert.match(
    migrationTest,
    /CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions/u,
  );
  assert.match(migrationTest, /SELECT extensions\.plan\(8\)/u);
  assert.match(migrationTest, /SELECT extensions\.is\(/u);
  assert.match(migrationTest, /SELECT \* FROM extensions\.finish\(\)/u);
  assert.match(migrationTest, /supported_install_contracts/u);
  assert.match(migrationTest, /1\.2\.3/u);
});

test("refuses prerelease and build versions in the stable integration lane", () => {
  for (const version of ["1.2.3-beta.2", "1.2.3+build.1"]) {
    const input = fixture();
    const manifest = JSON.parse(readFileSync(input.manifestPath, "utf8"));
    manifest.version = version;
    manifest.tag = `example-plugin/v${version}`;
    manifest.supportedInstallContracts.maximum = version;
    writeFileSync(input.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    assert.throws(() => integrate(input), /invalid plugin version/u);
  }
});

test("refuses versions the database semver key cannot represent", () => {
  for (const version of ["1000000000.0.0", "01.0.0"]) {
    const input = fixture();
    const manifest = JSON.parse(readFileSync(input.manifestPath, "utf8"));
    manifest.version = version;
    manifest.tag = `example-plugin/v${version}`;
    manifest.supportedInstallContracts.maximum = version;
    writeFileSync(input.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    assert.throws(() => integrate(input), /invalid plugin version/u);
  }
});

test("refuses the obsolete single-environment application artifact", () => {
  const input = fixture({ application: true });
  assert.throws(
    () => integrate(input),
    /invalid application build artifact contract/u,
  );
});

test("integrates separately hashed Development and Production builds", () => {
  const input = fixture({ application: true, multiEnvironment: true });
  const result = integrate(input);
  const registry = JSON.parse(readFileSync(input.registryPath, "utf8"));
  assert.equal(result.version, "1.2.3");
  assert.equal(registry.length, 2);
  assert.equal(registry[0].runtimeProfile, "embedded");
  assert.equal(registry[1].runtimeProfile, "application");
  assert.equal(registry[1].buildDigest, input.manifest.buildDigest);
  assert.equal(
    registry[1].buildArtifact.format,
    "vercel-prebuilt-multi-env-v1",
  );
  assert.notEqual(
    registry[1].buildArtifact.artifacts.development.digest,
    registry[1].buildArtifact.artifacts.production.digest,
  );
});

test("refuses an application build targeted at an unapproved project", () => {
  const input = fixture({ application: true, multiEnvironment: true });
  const targets = JSON.parse(
    readFileSync(input.applicationTargetsPath, "utf8"),
  );
  targets["example-plugin"].projectId = "prj_different";
  writeFileSync(
    input.applicationTargetsPath,
    `${JSON.stringify(targets, null, 2)}\n`,
  );

  assert.throws(() => integrate(input), /target is not approved/u);
});

test("refuses an application build rooted outside the approved child app", () => {
  const input = fixture({ application: true, multiEnvironment: true });
  const targets = JSON.parse(
    readFileSync(input.applicationTargetsPath, "utf8"),
  );
  targets["example-plugin"].root = "apps/other";
  writeFileSync(
    input.applicationTargetsPath,
    `${JSON.stringify(targets, null, 2)}\n`,
  );

  assert.throws(() => integrate(input), /target is not approved/u);
});

test("anchors later releases to the serving embedded catalog entry", () => {
  for (const application of [true, false]) {
    const input = fixture({
      application,
      priorApplication: true,
      multiEnvironment: application,
    });
    const manifest = JSON.parse(readFileSync(input.manifestPath, "utf8"));
    manifest.supportedInstallContracts.minimum = "1.2.1";
    writeFileSync(input.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    integrate(input);
    const migrationName = readdirSync(input.migrationsDir).find((file) =>
      file.startsWith("20260820150000_"),
    );
    const migration = readFileSync(
      join(input.migrationsDir, migrationName),
      "utf8",
    );

    assert.match(migration, /latest_version = '1\.2\.1'/u);
    assert.doesNotMatch(migration, /latest_version = '1\.2\.2'/u);
  }
});

test("refuses to drop the prior release minimum install contract", () => {
  const input = fixture({
    application: true,
    priorApplication: true,
    multiEnvironment: true,
  });
  assert.throws(
    () => integrate(input),
    /exclude the currently published install contract/u,
  );
});

test("refuses an inverted host API range", () => {
  const input = fixture({ application: true, multiEnvironment: true });
  const manifest = JSON.parse(readFileSync(input.manifestPath, "utf8"));
  manifest.hostApiRange = { minimum: "2.0.0", maximum: "1.0.0" };
  writeFileSync(input.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.throws(() => integrate(input), /invalid host API range/u);
});

test("refuses an application artifact whose bytes do not match the signature", () => {
  const input = fixture({ application: true, multiEnvironment: true });
  writeFileSync(input.buildPaths.development, "different bytes\n");

  assert.throws(() => integrate(input), /artifact digest is invalid/u);
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
  assert.match(workflow, /Record the embedded runtime pin/u);
  assert.match(
    workflow,
    /runtimeProfile[\s\S]*== application[\s\S]*steps\.embedded\.outputs\.source_commit/u,
  );
  assert.match(workflow, /--migration-version auto/u);
  assert.match(workflow, /group: plugin-release-integration\n/u);
  assert.match(workflow, /gh api \\\n\s+--paginate \\\n\s+--slurp/u);
  assert.match(workflow, /startswith\("codex\/plugin-release-"\)/u);
  assert.match(workflow, /A signed plugin integration PR is already open/u);
  assert.match(workflow, /supabase\/tests\/database/u);
  assert.match(workflow, /plugin-build-development\.tar\.gz/u);
  assert.match(workflow, /plugin-build-production\.tar\.gz/u);
  assert.match(workflow, /Unsupported application build format/u);
  assert.match(workflow, /vercel-prebuilt-multi-env-v1/u);
  assert.doesNotMatch(workflow, /plugin-build\.tar\.gz/u);
  assert.match(
    workflow,
    /bunx prettier --write lib\/plugins\/published-releases\.json/u,
  );
  assert.doesNotMatch(workflow, /gh release download "\$\{.*AssetUrl/u);
  assert.doesNotMatch(workflow, /--base main/u);
});
