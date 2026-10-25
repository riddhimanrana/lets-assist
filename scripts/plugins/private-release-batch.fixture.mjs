import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const hash = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

export function batchFixture({ uncovered = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "private-release-batch-"));
  const privateRoot = join(root, "private");
  const migrationsDir = join(root, "supabase/migrations");
  const testsDir = join(root, "supabase/tests/database");
  const artifacts = join(root, "artifacts");
  for (const path of [privateRoot, migrationsDir, testsDir, artifacts])
    mkdirSync(path, { recursive: true });
  const keys = [
    "first-plugin",
    "second-plugin",
    ...(uncovered ? ["third-plugin"] : []),
  ];
  git(privateRoot, "init", "-b", "main");
  git(privateRoot, "config", "user.name", "Synthetic release test");
  git(privateRoot, "config", "user.email", "release@local.test");
  for (const key of keys) {
    const directory = join(privateRoot, "plugins", key);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "plugin.ts"),
      'export const manifest = {\n  version: "1.0.0",\n};\n',
    );
    writeFileSync(
      join(directory, "feature.ts"),
      'export const value = "old";\n',
    );
    writeFileSync(
      join(directory, "CHANGELOG.md"),
      "# Changes\n\n## 1.0.1\n\nReviewed update.\n\n## 1.0.0\n\nOriginal.\n",
    );
  }
  git(privateRoot, "add", ".");
  git(privateRoot, "commit", "-m", "original");
  const servingPrivateCommit = git(privateRoot, "rev-parse", "HEAD");
  const registryPath = join(root, "published-releases.json");
  writeFileSync(
    registryPath,
    JSON.stringify(
      keys.map((pluginKey) => ({
        pluginKey,
        version: "1.0.0",
        sourceCommit: servingPrivateCommit,
        runtimeProfile: "embedded",
        signer: null,
        supportedInstallContracts: { minimum: "1.0.0", maximum: "1.0.0" },
      })),
    ),
  );
  for (const key of keys) {
    writeFileSync(
      join(privateRoot, "plugins", key, "plugin.ts"),
      'export const manifest = {\n  version: "1.0.1",\n};\n',
    );
    writeFileSync(
      join(privateRoot, "plugins", key, "feature.ts"),
      'export const value = "new";\n',
    );
  }
  git(privateRoot, "add", ".");
  git(privateRoot, "commit", "-m", "paired release");
  const sourceCommit = git(privateRoot, "rev-parse", "HEAD");
  for (const branch of ["main", "development"])
    git(
      privateRoot,
      "update-ref",
      `refs/remotes/origin/${branch}`,
      sourceCommit,
    );
  const releases = keys.slice(0, 2).map((pluginKey) => {
    const pluginPath = `plugins/${pluginKey}`;
    const entries = execFileSync(
      "git",
      ["ls-tree", "-r", "-z", sourceCommit, "--", pluginPath],
      { cwd: privateRoot },
    )
      .toString()
      .split("\0")
      .filter(Boolean)
      .map((record) => {
        const [header, path] = record.split("\t");
        const [mode, , object] = header.split(" ");
        const bytes = execFileSync("git", ["cat-file", "blob", object], {
          cwd: privateRoot,
        });
        return { path, mode, size: bytes.length, digest: hash(bytes) };
      })
      .sort((a, b) => a.path.localeCompare(b.path));
    const sbomPath = join(artifacts, `${pluginKey}.cdx.json`);
    writeFileSync(sbomPath, '{"bomFormat":"CycloneDX","specVersion":"1.6"}\n');
    const bundlePath = join(artifacts, `${pluginKey}.sigstore.json`);
    writeFileSync(
      bundlePath,
      '{"synthetic":"verified by the injected command runner"}\n',
    );
    const tag = `${pluginKey}/v1.0.1`;
    git(privateRoot, "tag", tag, sourceCommit);
    const manifestPath = join(artifacts, `${pluginKey}.json`);
    const manifest = {
      schemaVersion: 1,
      pluginKey,
      version: "1.0.1",
      tag,
      sourceCommit,
      sourceCommitTime: git(
        privateRoot,
        "show",
        "-s",
        "--format=%aI",
        sourceCommit,
      ),
      sourceTree: git(
        privateRoot,
        "rev-parse",
        `${sourceCommit}:${pluginPath}`,
      ),
      runtimeProfile: "embedded",
      releaseInputs: [pluginPath],
      fileCount: entries.length,
      files: entries,
      contentDigest: hash(
        Buffer.concat(
          entries.map((entry) =>
            Buffer.from(
              `${entry.mode}\0${entry.path}\0${entry.digest}\0${entry.size}\n`,
            ),
          ),
        ),
      ),
      manifestPath: `${pluginPath}/plugin.ts`,
      manifestDigest: entries.find((entry) => entry.path.endsWith("/plugin.ts"))
        .digest,
      changelogPath: `${pluginPath}/CHANGELOG.md`,
      changelogDigest: entries.find((entry) =>
        entry.path.endsWith("/CHANGELOG.md"),
      ).digest,
      buildDigest: null,
      buildArtifact: null,
      sbomDigest: hash(readFileSync(sbomPath)),
      signerIdentity: {
        subject: `https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/${tag}`,
        issuer: "https://token.actions.githubusercontent.com",
      },
      hostApiRange: { minimum: "1.0.0" },
      pluginDataSchemaVersion: 1,
      requiredPlatformSchemaVersion: "20261007220000",
      supportedInstallContracts: { minimum: "1.0.0", maximum: "1.0.1" },
    };
    writeFileSync(manifestPath, JSON.stringify(manifest));
    return { tag, manifestPath, sbomPath, bundlePath };
  });
  const releasesPath = join(artifacts, "releases.json");
  writeFileSync(releasesPath, JSON.stringify(releases));
  writeFileSync(
    join(migrationsDir, "20261007220000_existing.sql"),
    "SELECT 1;\n",
  );
  const sharedTest = join(testsDir, "prior_publications.test.sql");
  writeFileSync(
    sharedTest,
    keys
      .map(
        (key) =>
          `SELECT extensions.is(\n  (SELECT latest_version FROM public.plugins WHERE key = '${key}'),\n  '1.0.0'\n);\nSELECT extensions.is(\n  (SELECT code_reference FROM public.plugins WHERE key = '${key}'),\n  '${servingPrivateCommit}'\n);\n`,
      )
      .join("\n"),
  );
  git(privateRoot, "checkout", "--detach", servingPrivateCommit);
  return {
    root,
    privateRoot,
    registryPath,
    migrationsDir,
    testsDir,
    releasesPath,
    releases,
    sourceCommit,
    servingPrivateCommit,
    sharedTest,
  };
}

export function snapshotTargets(input) {
  const directoryFiles = (path) =>
    readdirSync(path)
      .sort()
      .map((name) => [name, readFileSync(join(path, name), "utf8")]);
  return {
    registry: readFileSync(input.registryPath, "utf8"),
    migrations: directoryFiles(input.migrationsDir),
    tests: directoryFiles(input.testsDir),
    privateHead: git(input.privateRoot, "rev-parse", "HEAD"),
  };
}
