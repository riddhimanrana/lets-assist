import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditPackageGraphs,
  assertExactPrivateGitlink,
  discoverPackageGraphs,
} from "../security/audit-package-graphs.mjs";

const roots = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "graph-audit-test-"));
  roots.push(root);
  const privateRoot = join(root, "lib/plugins/private");
  mkdirSync(join(privateRoot, ".git"), { recursive: true });
  const files = new Map([
    [root, []],
    [privateRoot, []],
  ]);
  function add(repository, directory) {
    const base = join(repository, directory);
    mkdirSync(base, { recursive: true });
    writeFileSync(
      join(base, "package.json"),
      JSON.stringify({ packageManager: "bun@1.3.14" }),
    );
    writeFileSync(join(base, "bun.lock"), "{}");
    files
      .get(repository)
      .push(
        ...["package.json", "bun.lock"].map((file) =>
          directory ? `${directory}/${file}` : file,
        ),
      );
  }
  add(root, "");
  add(root, "packages/plugin-sdk");
  add(privateRoot, "apps/one");
  add(privateRoot, "apps/two");
  return {
    root,
    privateRoot,
    files,
    add,
    list: (repository) => files.get(repository),
  };
}

describe("independent dependency audits", () => {
  function csfVendor() {
    const data = fixture();
    data.add(data.privateRoot, "apps/csf");
    const owner = join(data.privateRoot, "apps/csf");
    const vendor = join(owner, "vendor/fast-glob-compat");
    mkdirSync(vendor, { recursive: true });
    const manifest = {
      name: "fast-glob",
      version: "3.3.3-lets-assist.1",
      dependencies: { tinyglobby: "0.2.17" },
    };
    const ownerManifest = {
      packageManager: "bun@1.3.14",
      overrides: { "fast-glob": "file:./vendor/fast-glob-compat" },
    };
    writeFileSync(join(vendor, "package.json"), JSON.stringify(manifest));
    writeFileSync(join(owner, "package.json"), JSON.stringify(ownerManifest));
    writeFileSync(
      join(owner, "bun.lock"),
      JSON.stringify({
        packages: {
          "@vercel/microfrontends/fast-glob": [
            "fast-glob@file:./vendor/fast-glob-compat",
          ],
          tinyglobby: ["tinyglobby@0.2.17"],
        },
      }),
    );
    data.files
      .get(data.privateRoot)
      .push("apps/csf/vendor/fast-glob-compat/package.json");
    return { ...data, owner, vendor, manifest, ownerManifest };
  }

  test("the exact private compatibility package remains covered by its audited owner", () => {
    const data = csfVendor();
    const graphs = discoverPackageGraphs(data.root, data.list);
    expect(graphs.map((graph) => graph.label)).toEqual([
      ".",
      "packages/plugin-sdk",
      "lib/plugins/private/apps/csf",
      "lib/plugins/private/apps/one",
      "lib/plugins/private/apps/two",
    ]);
    const audited = [];
    expect(() =>
      auditPackageGraphs(graphs, {
        log: () => {},
        acceptFinding: () => false,
        spawn(_command, _args, options) {
          audited.push(options.cwd);
          return options.cwd === data.owner
            ? {
                status: 1,
                stdout: JSON.stringify({
                  braces: [
                    {
                      id: 1,
                      title: "Fictional advisory",
                      url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
                      severity: "high",
                      vulnerable_versions: "<=3.0.3",
                    },
                  ],
                }),
              }
            : { status: 0, stdout: "{}" };
        },
      }),
    ).toThrow("Dependency audit failed: lib/plugins/private/apps/csf");
    expect(audited).toContain(data.owner);
  });
  for (const mutation of [
    "override",
    "manifest",
    "lock",
    "standalone-lock",
    "orphan",
  ]) {
    test("refuses unbound private compatibility package: " + mutation, () => {
      const data = csfVendor();
      if (mutation === "override") {
        delete data.ownerManifest.overrides;
        writeFileSync(
          join(data.owner, "package.json"),
          JSON.stringify(data.ownerManifest),
        );
      } else if (mutation === "manifest") {
        data.manifest.dependencies.tinyglobby = "0.2.18";
        writeFileSync(
          join(data.vendor, "package.json"),
          JSON.stringify(data.manifest),
        );
      } else if (mutation === "lock")
        writeFileSync(join(data.owner, "bun.lock"), "{}");
      else if (mutation === "standalone-lock") {
        writeFileSync(join(data.vendor, "bun.lock"), "{}");
        data.files
          .get(data.privateRoot)
          .push("apps/csf/vendor/fast-glob-compat/bun.lock");
      } else
        data.files.set(
          data.privateRoot,
          data.files
            .get(data.privateRoot)
            .filter((file) => file !== "apps/csf/package.json"),
        );
      expect(() => discoverPackageGraphs(data.root, data.list)).toThrow();
    });
  }
  test("another private vendor package cannot inherit owner coverage", () => {
    const data = csfVendor();
    const path = "apps/csf/vendor/other/package.json";
    mkdirSync(join(data.privateRoot, "apps/csf/vendor/other"));
    writeFileSync(
      join(data.privateRoot, path),
      JSON.stringify({ packageManager: "bun@1.3.14" }),
    );
    data.files.get(data.privateRoot).push(path);
    expect(() => discoverPackageGraphs(data.root, data.list)).toThrow(
      "exactly one tracked Bun lockfile",
    );
  });
  test("the exact vendored glob dependency remains in the root audit, without skipping other vendor graphs", () => {
    const data = fixture();
    const directory = "vendor/fast-glob-compat";
    mkdirSync(join(data.root, directory), { recursive: true });
    writeFileSync(
      join(data.root, directory, "package.json"),
      JSON.stringify({
        name: "fast-glob",
        version: "3.3.3-lets-assist.1",
        dependencies: { tinyglobby: "0.2.17" },
      }),
    );
    data.files.get(data.root).push(`${directory}/package.json`);
    writeFileSync(
      join(data.root, "package.json"),
      JSON.stringify({
        packageManager: "bun@1.3.14",
        overrides: { "fast-glob": "file:./vendor/fast-glob-compat" },
      }),
    );
    writeFileSync(
      join(data.root, "bun.lock"),
      JSON.stringify({
        packages: {
          "fast-glob": ["fast-glob@file:vendor/fast-glob-compat"],
          tinyglobby: ["tinyglobby@0.2.17"],
        },
      }),
    );
    expect(
      discoverPackageGraphs(data.root, data.list).map((graph) => graph.label),
    ).toEqual([
      ".",
      "packages/plugin-sdk",
      "lib/plugins/private/apps/one",
      "lib/plugins/private/apps/two",
    ]);
    writeFileSync(join(data.root, "bun.lock"), "{}");
    expect(() => discoverPackageGraphs(data.root, data.list)).toThrow(
      "covered by the root lockfile",
    );
    data.files.get(data.root).pop();
    mkdirSync(join(data.root, "vendor/other"), { recursive: true });
    writeFileSync(
      join(data.root, "vendor/other/package.json"),
      JSON.stringify({ packageManager: "bun@1.3.14" }),
    );
    data.files.get(data.root).push("vendor/other/package.json");
    expect(() => discoverPackageGraphs(data.root, data.list)).toThrow(
      "exactly one tracked Bun lockfile",
    );
  });
  test("discovers the SDK and every private application graph", () => {
    const data = fixture();
    expect(
      discoverPackageGraphs(data.root, data.list).map((graph) => graph.label),
    ).toEqual([
      ".",
      "packages/plugin-sdk",
      "lib/plugins/private/apps/one",
      "lib/plugins/private/apps/two",
    ]);
  });
  test("refuses auditing an unpublished private branch instead of the indexed revision", () => {
    expect(() =>
      assertExactPrivateGitlink("/root", (_command, args) =>
        args[1] === "HEAD" ? "b".repeat(40) : "a".repeat(40),
      ),
    ).toThrow("root index gitlink");
  });

  test("refuses a private package left on the previous Bun pin", () => {
    const data = fixture();
    for (const directory of [
      data.root,
      join(data.root, "packages/plugin-sdk"),
    ]) {
      writeFileSync(
        join(directory, "package.json"),
        JSON.stringify({ packageManager: "bun@1.4.2" }),
      );
    }
    expect(() => discoverPackageGraphs(data.root, data.list)).toThrow(
      "lib/plugins/private/apps/one: packageManager must match the exact root Bun pin.",
    );
  });

  test("fails closed when a package loses its tracked lockfile", () => {
    const data = fixture();
    data.files.set(
      data.privateRoot,
      data.files
        .get(data.privateRoot)
        .filter((file) => file !== "apps/two/bun.lock"),
    );
    expect(() => discoverPackageGraphs(data.root, data.list)).toThrow(
      "exactly one tracked Bun lockfile",
    );
  });
  test("fails closed when the private checkout is unavailable", () => {
    const data = fixture();
    rmSync(join(data.privateRoot, ".git"), { recursive: true });
    expect(() => discoverPackageGraphs(data.root, data.list)).toThrow(
      "exact private submodule",
    );
  });
  test("audits without installs or ambient credentials and continues after failures", () => {
    const calls = [];
    expect(() =>
      auditPackageGraphs(
        [
          { label: ".", directory: "/root" },
          { label: "sdk", directory: "/sdk" },
        ],
        {
          environment: {
            PATH: "/bin",
            PRIVATE_SUBMODULE_SSH_KEY: "synthetic",
            NODE_OPTIONS: "synthetic",
            npm_config_registry: "synthetic",
          },
          log: () => {},
          spawn(command, args, options) {
            calls.push({ command, args, options });
            return { status: calls.length === 1 ? 1 : 0, stdout: "{}" };
          },
        },
      ),
    ).toThrow("Dependency audit failed: .");
    expect(calls).toHaveLength(2);
    expect(calls[0].args).toEqual(["--no-env-file", "audit", "--json"]);
    expect(calls[0].options.env.PRIVATE_SUBMODULE_SSH_KEY).toBeUndefined();
    expect(calls[0].options.env.NODE_OPTIONS).toBeUndefined();
    expect(calls[0].options.env.npm_config_registry).toBeUndefined();
    expect(existsSync(calls[0].options.env.HOME)).toBe(false);
  });
});
