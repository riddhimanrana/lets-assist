#!/usr/bin/env node

import { existsSync, lstatSync, rmSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const apply = process.argv.includes("--apply");
const allowed = Object.freeze([
  ".artifacts",
  ".next",
  ".next-csf-isolated",
  "artifacts",
  "coverage",
  "playwright-report",
  "test-results",
]);

console.log(`[clean-artifacts] ${apply ? "APPLY" : "DRY RUN"}`);
for (const relativePath of allowed) {
  const target = path.resolve(repoRoot, relativePath);
  if (path.dirname(target) !== repoRoot || target === repoRoot) {
    throw new Error(`Unsafe cleanup target: ${target}`);
  }
  if (!existsSync(target)) continue;
  const kind = lstatSync(target).isDirectory() ? "directory" : "file";
  console.log(
    `[clean-artifacts] ${apply ? "remove" : "would remove"} ${relativePath} (${kind})`,
  );
  if (apply) rmSync(target, { recursive: true, force: true });
}

if (!apply) {
  console.log(
    "[clean-artifacts] No files changed. Run `bun run clean:artifacts:apply` to remove the allowlisted paths.",
  );
}
