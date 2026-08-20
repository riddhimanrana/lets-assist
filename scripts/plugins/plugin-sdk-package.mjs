import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const STABLE_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function listFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

export function pluginSdkPackagePaths(repositoryRoot) {
  const packageRoot = join(repositoryRoot, "packages/plugin-sdk");
  return {
    repositoryRoot,
    packageRoot,
    packageJsonPath: join(packageRoot, "package.json"),
    sourceRoot: join(repositoryRoot, "lib/plugins/sdk/v1"),
    distRoot: join(packageRoot, "dist"),
  };
}

export function readPluginSdkPackage(repositoryRoot) {
  const paths = pluginSdkPackagePaths(repositoryRoot);
  const packageJson = JSON.parse(readFileSync(paths.packageJsonPath, "utf8"));
  if (packageJson.name !== "@lets-assist/plugin-sdk") {
    throw new Error(
      "Plugin SDK package name must remain @lets-assist/plugin-sdk.",
    );
  }
  if (!STABLE_VERSION.test(packageJson.version)) {
    throw new Error("Plugin SDK releases require a stable semantic version.");
  }
  return { paths, packageJson };
}

export function collectPluginSdkReleaseInputs(repositoryRoot) {
  const { paths } = readPluginSdkPackage(repositoryRoot);
  const sourceFiles = listFiles(paths.sourceRoot).filter(
    (path) => path.endsWith(".ts") && !path.endsWith(".test.ts"),
  );
  const packageFiles = [
    paths.packageJsonPath,
    join(paths.packageRoot, "README.md"),
    join(paths.packageRoot, "bun.lock"),
    join(paths.packageRoot, "tsconfig.build.json"),
  ];
  return [...sourceFiles, ...packageFiles]
    .map((path) => ({
      path: relative(repositoryRoot, path).replaceAll("\\", "/"),
      bytes: readFileSync(path),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function pluginSdkSourceDigest(repositoryRoot) {
  const hash = createHash("sha256");
  for (const file of collectPluginSdkReleaseInputs(repositoryRoot)) {
    hash.update(`${file.path}\0${file.bytes.byteLength}\0`, "utf8");
    hash.update(file.bytes);
    hash.update("\n", "utf8");
  }
  return hash.digest("hex");
}

export async function buildPluginSdkPackage(repositoryRoot) {
  const { paths, packageJson } = readPluginSdkPackage(repositoryRoot);
  rmSync(paths.distRoot, { recursive: true, force: true });
  mkdirSync(paths.distRoot, { recursive: true });

  const build = await globalThis.Bun.build({
    entrypoints: [join(paths.sourceRoot, "index.ts")],
    outdir: paths.distRoot,
    format: "esm",
    target: "node",
    external: ["ajv"],
    minify: false,
    sourcemap: "external",
    naming: "index.js",
  });
  if (!build.success) {
    throw new Error(
      `Plugin SDK bundle failed: ${build.logs.map((entry) => entry.message).join("; ")}`,
    );
  }

  execFileSync(
    "bunx",
    ["tsc", "-p", join(paths.packageRoot, "tsconfig.build.json")],
    { cwd: repositoryRoot, stdio: "inherit" },
  );

  const entrypoint = join(paths.distRoot, "index.js");
  const declarations = join(paths.distRoot, "index.d.ts");
  if (!existsSync(entrypoint) || !existsSync(declarations)) {
    throw new Error(
      "Plugin SDK build did not create its JavaScript and declaration entrypoints.",
    );
  }

  return {
    name: packageJson.name,
    version: packageJson.version,
    sourceDigest: pluginSdkSourceDigest(repositoryRoot),
    buildDigest: digest(readFileSync(entrypoint)),
  };
}

export function createPluginSdkReleaseManifest({
  repositoryRoot,
  sourceCommit,
  tarballPath,
  sbomPath,
}) {
  const { packageJson } = readPluginSdkPackage(repositoryRoot);
  if (!COMMIT.test(sourceCommit))
    throw new Error("sourceCommit must be a full Git commit SHA.");
  for (const path of [tarballPath, sbomPath]) {
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new Error(`Missing release input ${path}.`);
    }
  }

  const tarballBytes = readFileSync(tarballPath);
  const sbomBytes = readFileSync(sbomPath);
  const manifest = {
    schemaVersion: 1,
    packageName: packageJson.name,
    version: packageJson.version,
    tag: `plugin-sdk/v${packageJson.version}`,
    sourceCommit,
    sourceDigest: pluginSdkSourceDigest(repositoryRoot),
    tarball: basename(tarballPath),
    tarballDigest: digest(tarballBytes),
    sbom: basename(sbomPath),
    sbomDigest: digest(sbomBytes),
  };
  for (const value of [
    manifest.sourceDigest,
    manifest.tarballDigest,
    manifest.sbomDigest,
  ]) {
    if (!SHA256.test(value))
      throw new Error("Release manifest contains an invalid digest.");
  }
  return manifest;
}

export function writePluginSdkReleaseManifest(options, outputPath) {
  const manifest = createPluginSdkReleaseManifest(options);
  mkdirSync(resolve(outputPath, ".."), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
