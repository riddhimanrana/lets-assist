import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildPluginSdkPackage,
  collectPluginSdkReleaseInputs,
  createPluginSdkReleaseManifest,
  pluginSdkSourceDigest,
  readPluginSdkPackage,
} from "./plugin-sdk-package.mjs";

const repositoryRoot = resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);

test("the SDK package has a stable public identity", () => {
  const { packageJson } = readPluginSdkPackage(repositoryRoot);
  expect(packageJson.name).toBe("@lets-assist/plugin-sdk");
  expect(packageJson.version).toBe("1.0.1");
  expect(packageJson.private).toBeUndefined();
  expect(packageJson.files).toEqual(["dist", "README.md"]);
});

test("the source digest is stable and covers the serializable SDK", () => {
  const inputs = collectPluginSdkReleaseInputs(repositoryRoot).map(
    ({ path }) => path,
  );
  const first = pluginSdkSourceDigest(repositoryRoot);
  const second = pluginSdkSourceDigest(repositoryRoot);
  expect(first).toMatch(/^[0-9a-f]{64}$/u);
  expect(first).toBe(second);
  expect(inputs).toContain("packages/plugin-sdk/bun.lock");
  expect(inputs).toContain("lib/plugins/sdk/v1/index.ts");
});

test("the package builds without host or private imports", async () => {
  const result = await buildPluginSdkPackage(repositoryRoot);
  expect(result.name).toBe("@lets-assist/plugin-sdk");
  const sdkModule = await import(
    `${new URL("../../packages/plugin-sdk/dist/index.js", import.meta.url)}?test=${Date.now()}`
  );
  expect(sdkModule.PLUGIN_HOST_API_VERSION).toBeUndefined();
  expect(sdkModule.profileRequiresBuildProvenance("application")).toBe(true);
  expect(sdkModule.profileRequiresBuildProvenance("embedded")).toBe(false);
});

test("the signed manifest binds source, package bytes, and SBOM bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "plugin-sdk-release-"));
  const tarballPath = join(root, "lets-assist-plugin-sdk-1.0.1.tgz");
  const sbomPath = join(root, "plugin-sdk.cdx.json");
  mkdirSync(root, { recursive: true });
  writeFileSync(tarballPath, "package");
  writeFileSync(sbomPath, '{"bomFormat":"CycloneDX"}\n');

  const manifest = createPluginSdkReleaseManifest({
    repositoryRoot,
    sourceCommit: "a".repeat(40),
    tarballPath,
    sbomPath,
  });
  expect(manifest.tag).toBe("plugin-sdk/v1.0.1");
  expect(manifest.tarballDigest).toMatch(/^[0-9a-f]{64}$/u);
  expect(manifest.sbomDigest).toMatch(/^[0-9a-f]{64}$/u);
  expect(manifest.tarballDigest).not.toBe(manifest.sbomDigest);
});
