#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

export function unitTestArguments(changedFiles) {
  const applicationOnly = changedFiles.every(
    (file) =>
      /^(?:app|components|services|lib)\//u.test(file) &&
      file !== "lib/plugins/private",
  );
  return [
    "scripts/run-tests.mjs",
    ...(applicationOnly ? ["--application-only"] : []),
  ];
}

export function runAffectedUnitTests(
  baseSha,
  { exec = execFileSync, spawn = spawnSync, log = console.log } = {},
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
  const result = spawn(process.execPath, unitTestArguments(changedFiles), {
    stdio: "inherit",
    env: process.env,
  });
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
  if (process.argv.length !== 3)
    throw new Error("Usage: run-affected-unit-tests.mjs <base-sha>");
  runAffectedUnitTests(process.argv[2]);
}
