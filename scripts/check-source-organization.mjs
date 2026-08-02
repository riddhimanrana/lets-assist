#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const SOURCE_ORGANIZATION_RULES = Object.freeze({
  GENERATED_ARTIFACT: "generated-artifact",
  SCRATCH_SOURCE: "scratch-source",
  BACKUP_SOURCE: "backup-source",
});

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const SOURCE_ROOTS = new Set([
  "app",
  "components",
  "contexts",
  "hooks",
  "lib",
  "plugins",
  "services",
  "types",
  "utils",
]);

function normalizeRepoPath(file) {
  return file.split(path.sep).join("/").replace(/^\.\//, "");
}

export function findSourceOrganizationIssues(files) {
  const issues = [];

  for (const input of files) {
    const file = normalizeRepoPath(input);
    const basename = path.posix.basename(file);
    const extension = path.posix.extname(file).toLowerCase();
    const root = file.split("/", 1)[0];

    if (
      basename === ".DS_Store" ||
      basename.endsWith(".tsbuildinfo") ||
      basename.endsWith(".log")
    ) {
      issues.push({
        file,
        rule: SOURCE_ORGANIZATION_RULES.GENERATED_ARTIFACT,
        message: "Generated editor, compiler, and log artifacts must not be tracked.",
      });
    }

    if (
      SOURCE_EXTENSIONS.has(extension) &&
      (file.startsWith("scratch/") ||
        file.startsWith("tmp/") ||
        file.startsWith("temp/"))
    ) {
      issues.push({
        file,
        rule: SOURCE_ORGANIZATION_RULES.SCRATCH_SOURCE,
        message: "Ad-hoc source belongs in a named script, fixture, or test directory.",
      });
    }

    if (
      SOURCE_ROOTS.has(root) &&
      /(?:^|[._-])(?:backup|bak|copy|old|orig|rej|tmp)(?:[._-]|$)/iu.test(basename)
    ) {
      issues.push({
        file,
        rule: SOURCE_ORGANIZATION_RULES.BACKUP_SOURCE,
        message: "Source-control history replaces backup or copy files in production roots.",
      });
    }
  }

  return issues.sort(
    (left, right) =>
      left.file.localeCompare(right.file) || left.rule.localeCompare(right.rule),
  );
}

export function getTrackedFiles(repoRoot = process.cwd()) {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "Unable to list tracked files.");
  }

  return result.stdout
    .split("\0")
    .filter(Boolean)
    .filter((file) => existsSync(path.join(repoRoot, file)));
}

function main() {
  const repoRoot = process.cwd();
  const issues = findSourceOrganizationIssues(getTrackedFiles(repoRoot));

  if (issues.length === 0) {
    console.log(
      `[source-organization] PASS: tracked source layout is clean (${path.basename(repoRoot)}).`,
    );
    return;
  }

  for (const issue of issues) {
    console.error(
      `[source-organization] FAIL ${issue.rule}: ${issue.file}\n  ${issue.message}`,
    );
  }
  process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
