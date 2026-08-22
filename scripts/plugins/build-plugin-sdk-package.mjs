#!/usr/bin/env bun

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPluginSdkPackage } from "./plugin-sdk-package.mjs";

const repositoryRoot = resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);
const result = await buildPluginSdkPackage(repositoryRoot);
process.stdout.write(`${JSON.stringify(result)}\n`);
