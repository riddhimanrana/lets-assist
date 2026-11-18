import { afterEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  discoverPackageGraphs,
  PICOMATCH_COMPAT,
} from "../security/audit-package-graphs.mjs";

const roots = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);

const hoisted =
  '    "picomatch": ["picomatch@file:vendor/picomatch-compat", {}],';
const nested =
  '    "tinyglobby/picomatch": ["picomatch@file:./vendor/picomatch-compat", {}],';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "picomatch-audit-test-"));
  roots.push(root);
  const privateRoot = join(root, "lib/plugins/private");
  mkdirSync(join(privateRoot, ".git"), { recursive: true });
  const files = new Map([
    [root, []],
    [privateRoot, []],
  ]);
  const owners = { root: "", csf: "apps/csf" };
  function writeOwner(repository, owner, manifest, lock) {
    const base = join(repository, owner);
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "package.json"), JSON.stringify(manifest));
    writeFileSync(join(base, "bun.lock"), lock);
  }
  function vendor(repository, owner) {
    const directory = `${owner ? `${owner}/` : ""}vendor/picomatch-compat`;
    for (const name of [
      ...Object.keys(PICOMATCH_COMPAT.files),
      ...PICOMATCH_COMPAT.documents,
    ]) {
      const target = join(repository, directory, name);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(
        new URL(`../../vendor/picomatch-compat/${name}`, import.meta.url),
        target,
      );
      files.get(repository).push(`${directory}/${name}`);
    }
    return join(repository, directory);
  }
  const manifest = {
    packageManager: "bun@1.3.14",
    dependencies: { picomatch: PICOMATCH_COMPAT.dependency },
    overrides: { picomatch: PICOMATCH_COMPAT.override },
  };
  const lock = [hoisted, nested].join("\n");
  writeOwner(root, owners.root, manifest, lock);
  writeOwner(privateRoot, owners.csf, manifest, lock);
  files.get(root).push("package.json", "bun.lock");
  files.get(privateRoot).push("apps/csf/package.json", "apps/csf/bun.lock");
  const rootVendor = vendor(root, owners.root);
  const csfVendor = vendor(privateRoot, owners.csf);
  return {
    root,
    privateRoot,
    manifest,
    lock,
    rootVendor,
    csfVendor,
    list: (repository) => files.get(repository),
    files,
  };
}

describe("vendored picomatch repair", () => {
  test("stays inside each owning application's graph", () => {
    const data = fixture();
    expect(
      discoverPackageGraphs(data.root, data.list).map((graph) => graph.label),
    ).toEqual([".", "lib/plugins/private/apps/csf"]);
  });

  test("the committed root and CSF manifests bind the same repair", () => {
    const root = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    );
    expect(root.overrides.picomatch).toBe(PICOMATCH_COMPAT.override);
    expect(root.dependencies.picomatch).toBe(PICOMATCH_COMPAT.dependency);
    const lock = readFileSync(
      new URL("../../bun.lock", import.meta.url),
      "utf8",
    );
    expect(lock).not.toMatch(/"picomatch@\d/u);
  });

  const mutations = {
    "missing override"(data, repository) {
      const manifest = { ...data.manifest, overrides: {} };
      writeFileSync(join(repository, "package.json"), JSON.stringify(manifest));
    },
    "missing dependency that installs the override"(data, repository) {
      const manifest = { ...data.manifest, dependencies: {} };
      writeFileSync(join(repository, "package.json"), JSON.stringify(manifest));
    },
    "registry picomatch left in the lock"(data, repository) {
      writeFileSync(
        join(repository, "bun.lock"),
        `${data.lock}\n    "fdir/picomatch": ["picomatch@4.0.7", "", {}, "sha512-x"],`,
      );
    },
    "modified parser"(data, repository, vendor) {
      appendFileSync(join(vendor, "lib/parse.js"), "\n");
    },
    "manifest gaining a dependency"(data, repository, vendor) {
      const path = join(vendor, "package.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      writeFileSync(
        path,
        JSON.stringify({ ...manifest, dependencies: { other: "1.0.0" } }),
      );
    },
  };

  for (const [name, mutate] of Object.entries(mutations)) {
    for (const owner of ["root", "csf"]) {
      test(`refuses ${name} in the ${owner} graph`, () => {
        const data = fixture();
        const repository =
          owner === "root" ? data.root : join(data.privateRoot, "apps/csf");
        mutate(
          data,
          repository,
          owner === "root" ? data.rootVendor : data.csfVendor,
        );
        expect(() => discoverPackageGraphs(data.root, data.list)).toThrow(
          "vendored picomatch repair",
        );
      });
    }
  }

  test("refuses an extra tracked file in the vendored package", () => {
    const data = fixture();
    writeFileSync(join(data.rootVendor, "extra.js"), "module.exports = {};");
    data.files.get(data.root).push("vendor/picomatch-compat/extra.js");
    expect(() => discoverPackageGraphs(data.root, data.list)).toThrow(
      "vendored picomatch repair",
    );
  });
});
