#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { shardFromArguments } from "./test-shards.mjs";

// Filesystem and subprocess contracts are common here. Keep selection at the
// application/tooling boundary instead of guessing edges from imports alone.
export function requiresUnitTests(changedFiles) {
  return changedFiles.some(
    (file) =>
      !(
        /^docs\/.*\.md$/u.test(file) ||
        /^(?:README|LICENSE|CHANGELOG)(?:\.md)?$/u.test(file)
      ),
  );
}

export function unitTestArguments(changedFiles, shard = null) {
  const applicationOnly = changedFiles.every(
    (file) =>
      /^(?:app|components|services|lib)\//u.test(file) &&
      file !== "lib/plugins/private",
  );
  return [
    "scripts/run-tests.mjs",
    ...(applicationOnly ? ["--application-only"] : []),
    // The orchestrator owns the partition. Every shard receives the same scope
    // from the same diff, so the shards of one run cover the same inventory.
    ...(shard ? [`--shard=${shard.index}/${shard.total}`] : []),
  ];
}

export function affectedArguments(args) {
  const positional = args.filter((argument) => !argument.startsWith("--"));
  const flags = args.filter((argument) => argument.startsWith("--"));
  if (
    positional.length !== 1 ||
    flags.some((flag) => !flag.startsWith("--shard"))
  ) {
    throw new Error(
      "Usage: run-affected-unit-tests.mjs <base-sha> [--shard=<index>/<total>]",
    );
  }
  return { baseSha: positional[0], shard: shardFromArguments(flags) };
}

export function runAffectedUnitTests(
  baseSha,
  {
    exec = execFileSync,
    spawn = spawnSync,
    log = console.log,
    shard = null,
  } = {},
) {
  if (!/^[0-9a-f]{40}$/u.test(baseSha ?? "")) {
    throw new Error("An exact 40-character pull request base SHA is required.");
  }
  const changedFiles = exec(
    "git",
    ["diff", "--name-only", "--no-renames", "-z", baseSha, "HEAD", "--"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  if (!requiresUnitTests(changedFiles)) {
    log(
      "[affected-tests] No runtime, test, configuration, or tooling changes.",
    );
    return;
  }
  log(
    `[affected-tests] ${changedFiles.length} changed paths; running affected unit groups with existing mock isolation.`,
  );
  const result = spawn(
    process.execPath,
    unitTestArguments(changedFiles, shard),
    {
      stdio: "inherit",
      env: process.env,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `Affected unit tests failed (${result.status ?? "terminated"}).`,
    );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { baseSha, shard } = affectedArguments(process.argv.slice(2));
  runAffectedUnitTests(baseSha, { shard });
}
