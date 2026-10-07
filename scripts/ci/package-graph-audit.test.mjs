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
    list: (repository) => files.get(repository),
  };
}

describe("independent dependency audits", () => {
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
            return { status: calls.length === 1 ? 1 : 0 };
          },
        },
      ),
    ).toThrow("Dependency audit failed: .");
    expect(calls).toHaveLength(2);
    expect(calls[0].args).toEqual(["--no-env-file", "audit"]);
    expect(calls[0].options.env.PRIVATE_SUBMODULE_SSH_KEY).toBeUndefined();
    expect(calls[0].options.env.NODE_OPTIONS).toBeUndefined();
    expect(calls[0].options.env.npm_config_registry).toBeUndefined();
    expect(existsSync(calls[0].options.env.HOME)).toBe(false);
  });
});
