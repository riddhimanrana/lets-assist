#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { writePluginSdkReleaseManifest } from "./plugin-sdk-package.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const repositoryRoot = resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);
const outputPath = resolve(option("--output"));
const manifest = writePluginSdkReleaseManifest(
  {
    repositoryRoot,
    sourceCommit: option("--source-commit"),
    tarballPath: resolve(option("--tarball")),
    sbomPath: resolve(option("--sbom")),
  },
  outputPath,
);
process.stdout.write(`${JSON.stringify(manifest)}\n`);
