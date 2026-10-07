import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { test, afterEach } from "node:test";
import {
  batchFixture,
  git,
  snapshotTargets,
} from "./private-release-batch.fixture.mjs";
import {
  inspectPrivateReleaseBatch,
  integratePrivateReleaseBatch,
} from "./integrate-private-release-batch.mjs";
import { integratePrivateRelease } from "./integrate-private-release.mjs";

const roots = [];
const fixture = (options) => {
  const input = batchFixture(options);
  roots.push(input.root);
  return input;
};
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const mutateManifest = (row, change) => {
  const value = JSON.parse(readFileSync(row.manifestPath, "utf8"));
  change(value);
  writeFileSync(row.manifestPath, JSON.stringify(value));
};
const verified = { execute: () => Buffer.from("verified") };

test("a verified two-plugin batch creates one transaction, both contracts and one complete registry", () => {
  const input = fixture();
  const calls = [];
  assert.equal(
    inspectPrivateReleaseBatch(input.releasesPath).sourceCommit,
    input.sourceCommit,
  );
  const result = integratePrivateReleaseBatch(input, {
    execute: (...args) => {
      calls.push(args);
      return Buffer.from("verified");
    },
  });
  assert.equal(calls.length, 2);
  for (const [index, [binary, args, options]] of calls.entries()) {
    assert.equal(binary, "cosign");
    assert.deepEqual(args, [
      "verify-blob",
      "--bundle",
      input.releases[index].bundlePath,
      "--certificate-identity",
      `https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/${input.releases[index].tag}`,
      "--certificate-oidc-issuer",
      "https://token.actions.githubusercontent.com",
      input.releases[index].manifestPath,
    ]);
    assert.equal(options.timeout, 60_000);
  }
  assert.equal(result.sourceCommit, input.sourceCommit);
  assert.equal(git(input.privateRoot, "rev-parse", "HEAD"), input.sourceCommit);
  assert.match(
    result.migrationPath,
    /20261007220001_publish_private_plugin_batch\.sql$/u,
  );
  const sql = readFileSync(result.migrationPath, "utf8");
  assert.equal((sql.match(/^BEGIN;$/gmu) ?? []).length, 1);
  assert.equal((sql.match(/^COMMIT;$/gmu) ?? []).length, 1);
  assert.equal(
    (sql.match(/INSERT INTO public.plugin_versions/gu) ?? []).length,
    2,
  );
  assert.doesNotMatch(
    sql,
    /(?:INSERT INTO|UPDATE|DELETE FROM) public.organization_plugin_installs/u,
  );
  const registry = JSON.parse(readFileSync(input.registryPath, "utf8"));
  assert.deepEqual(
    registry.map((row) => [row.pluginKey, row.version, row.sourceCommit]),
    [
      ["first-plugin", "1.0.1", input.sourceCommit],
      ["second-plugin", "1.0.1", input.sourceCommit],
    ],
  );
  assert.equal(result.migrationTestPaths.length, 3);
  assert.ok(result.migrationTestPaths.includes(input.sharedTest));
  const updated = readFileSync(input.sharedTest, "utf8");
  assert.equal((updated.match(/'1\.0\.1'/gu) ?? []).length, 2);
  assert.equal(updated.split(input.sourceCommit).length - 1, 2);
});

test("ordering is deterministic from the ledger and plugin identities", () => {
  const input = fixture();
  writeFileSync(
    input.releasesPath,
    JSON.stringify([...input.releases].reverse()),
  );
  const result = integratePrivateReleaseBatch(input, verified);
  assert.deepEqual(
    result.releases.map((release) => release.pluginKey),
    ["first-plugin", "second-plugin"],
  );
  assert.match(result.migrationPath, /20261007220001_/u);
});

for (const [label, mutate, pattern, options] of [
  [
    "missing release",
    (i) =>
      writeFileSync(i.releasesPath, JSON.stringify(i.releases.slice(0, 1))),
    /between two and sixteen/u,
  ],
  [
    "duplicate plugin",
    (i) =>
      writeFileSync(
        i.releasesPath,
        JSON.stringify([i.releases[0], i.releases[0]]),
      ),
    /duplicate plugin/u,
  ],
  [
    "mixed source commits",
    (i) =>
      mutateManifest(i.releases[1], (m) => {
        m.sourceCommit = i.servingPrivateCommit;
      }),
    /same exact private source/u,
  ],
  [
    "unsupported profile",
    (i) =>
      mutateManifest(i.releases[1], (m) => {
        m.runtimeProfile = "service";
      }),
    /does not support service/u,
  ],
  [
    "missing bundle",
    (i) => rmSync(i.releases[1].bundlePath),
    /missing release asset/u,
  ],
  [
    "incorrect tag",
    (i) => {
      i.releases[1].tag = "second-plugin/v9.0.0";
      writeFileSync(i.releasesPath, JSON.stringify(i.releases));
    },
    /tag does not match/u,
  ],
  [
    "unexpected input field",
    (i) => {
      i.releases[0].verified = true;
      writeFileSync(i.releasesPath, JSON.stringify(i.releases));
    },
    /exact tag and known asset/u,
  ],
  [
    "wrong SBOM",
    (i) => writeFileSync(i.releases[1].sbomPath, "changed"),
    /SBOM bytes/u,
  ],
  [
    "wrong content digest",
    (i) =>
      mutateManifest(i.releases[1], (m) => {
        m.contentDigest = `sha256:${"a".repeat(64)}`;
      }),
    /content digest/u,
  ],
  [
    "unchanged version",
    (i) => {
      const rows = JSON.parse(readFileSync(i.registryPath, "utf8"));
      rows[1].version = "1.0.1";
      writeFileSync(i.registryPath, JSON.stringify(rows));
    },
    /newer than the published/u,
  ],
  [
    "unregistered plugin",
    (i) => {
      const rows = JSON.parse(readFileSync(i.registryPath, "utf8"));
      writeFileSync(i.registryPath, JSON.stringify(rows.slice(0, 1)));
    },
    /absent from the root runtime registry/u,
  ],
  [
    "independent application profile",
    (i) =>
      mutateManifest(i.releases[1], (m) => {
        m.schemaVersion = 3;
        m.runtimeProfile = "application";
        m.manifestPath = "apps/example/plugin.ts";
        m.releaseInputs.push("apps/example");
        m.buildDigest = `sha256:${"a".repeat(64)}`;
        m.buildArtifact = {
          format: "vercel-prebuilt-multi-env-v1",
          root: "apps/example",
          projectName: "example-app",
          projectId: "prj_example",
          organizationId: "team_example",
          artifacts: Object.fromEntries(
            ["development", "production"].map((environment) => [
              environment,
              {
                name: `plugin-build-${environment}.tar.gz`,
                digest: `sha256:${"b".repeat(64)}`,
              },
            ]),
          ),
        };
      }),
    /supports embedded releases only/u,
  ],
  [
    "uncovered changed plugin",
    () => {},
    /published embedded code for third-plugin/u,
    { uncovered: true },
  ],
  [
    "tag moved",
    (i) =>
      git(
        i.privateRoot,
        "tag",
        "-f",
        i.releases[1].tag,
        i.servingPrivateCommit,
      ),
    /tag or promotion ancestry/u,
  ],
  [
    "unpromoted source",
    (i) =>
      git(
        i.privateRoot,
        "update-ref",
        "refs/remotes/origin/main",
        i.servingPrivateCommit,
      ),
    /tag or promotion ancestry/u,
  ],
  [
    "malformed serving expectation",
    (i) =>
      writeFileSync(
        i.sharedTest,
        "SELECT latest_version FROM public.plugins WHERE key = 'second-plugin';\n",
      ),
    /serving catalog expectation/u,
  ],
])
  test(`${label} refuses before every host write and private checkout change`, () => {
    const input = fixture(options);
    mutate(input);
    const before = snapshotTargets(input);
    assert.throws(() => integratePrivateReleaseBatch(input, verified), pattern);
    assert.deepEqual(snapshotTargets(input), before);
  });

test("a failed second signature preserves all targets and hides command diagnostics", () => {
  const input = fixture();
  const before = snapshotTargets(input);
  let calls = 0;
  assert.throws(
    () =>
      integratePrivateReleaseBatch(input, {
        execute: () => {
          calls += 1;
          if (calls === 2) throw new Error("private command diagnostic");
          return Buffer.from("verified");
        },
      }),
    (error) =>
      /signature verification failed for second-plugin/u.test(error.message) &&
      !error.message.includes("private command diagnostic"),
  );
  assert.equal(calls, 2);
  assert.deepEqual(snapshotTargets(input), before);
});

test("single-release integration still refuses the paired tree change", () => {
  const input = fixture();
  const before = snapshotTargets(input);
  assert.throws(
    () =>
      integratePrivateRelease({
        ...input,
        ...input.releases[0],
        migrationVersion: "20261007220001",
        attestationRef: `github-release:${input.releases[0].tag}/release-manifest.sigstore.json`,
      }),
    /published embedded code for second-plugin/u,
  );
  assert.deepEqual(snapshotTargets(input), before);
});
