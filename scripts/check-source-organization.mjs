#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const SOURCE_ORGANIZATION_RULES = Object.freeze({
  GENERATED_ARTIFACT: "generated-artifact",
  SCRATCH_SOURCE: "scratch-source",
  BACKUP_SOURCE: "backup-source",
  HIDDEN_DOCUMENTATION: "hidden-documentation",
  ROOT_BINARY: "root-binary",
  AGENT_WORKTREE: "agent-worktree",
  MAINTAINABILITY_LIMIT: "maintainability-limit",
});

const GENERATED_DIRECTORIES = new Set([
  ".artifacts",
  ".next",
  ".next-csf-isolated",
  "artifacts",
  "coverage",
  "playwright-report",
  "test-results",
]);
const BINARY_EXTENSIONS = new Set([
  ".7z",
  ".doc",
  ".docx",
  ".gif",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp4",
  ".otf",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".tar",
  ".ttf",
  ".webp",
  ".xls",
  ".xlsx",
  ".zip",
]);

// Temporary ratchet for files that predate this gate. New oversized files and
// growth beyond these reviewed line counts fail immediately; cleanup PRs remove
// entries as modules are split below their category limit.
const OVERSIZED_BASELINE = Object.freeze({
  "lets-assist": Object.freeze({}),
  private: Object.freeze({}),
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

    if (GENERATED_DIRECTORIES.has(root)) {
      issues.push({
        file,
        rule: SOURCE_ORGANIZATION_RULES.GENERATED_ARTIFACT,
        message:
          "Generated output belongs in ignored local artifact directories.",
      });
    }

    if (file.startsWith(".claude/worktrees/")) {
      issues.push({
        file,
        rule: SOURCE_ORGANIZATION_RULES.AGENT_WORKTREE,
        message: "Agent worktrees must remain outside the tracked repository.",
      });
    }

    if (root === file && BINARY_EXTENSIONS.has(extension)) {
      issues.push({
        file,
        rule: SOURCE_ORGANIZATION_RULES.ROOT_BINARY,
        message:
          "Binary fixtures and assets require a named docs, public, or application directory.",
      });
    }

    if (/^\.[^/]+\.(?:md|mdx)$/iu.test(file)) {
      issues.push({
        file,
        rule: SOURCE_ORGANIZATION_RULES.HIDDEN_DOCUMENTATION,
        message:
          "Documentation must be discoverable through AGENTS.md or docs/.",
      });
    }

    if (
      basename === ".DS_Store" ||
      basename.endsWith(".tsbuildinfo") ||
      basename.endsWith(".log")
    ) {
      issues.push({
        file,
        rule: SOURCE_ORGANIZATION_RULES.GENERATED_ARTIFACT,
        message:
          "Generated editor, compiler, and log artifacts must not be tracked.",
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
        message:
          "Ad-hoc source belongs in a named script, fixture, or test directory.",
      });
    }

    if (
      SOURCE_ROOTS.has(root) &&
      /(?:^|[._-])(?:backup|bak|copy|old|orig|rej|tmp)(?:[._-]|$)/iu.test(
        basename,
      )
    ) {
      issues.push({
        file,
        rule: SOURCE_ORGANIZATION_RULES.BACKUP_SOURCE,
        message:
          "Source-control history replaces backup or copy files in production roots.",
      });
    }
  }

  return issues.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.rule.localeCompare(right.rule),
  );
}

function maintainabilityLimit(file) {
  if (/(?:^|\/)(?:supabase\/migrations|generated)(?:\/|$)/u.test(file))
    return null;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file)) return 1200;
  if (/(?:^|\/)components\/CsfDashboard[A-Za-z]*Phase\.[jt]sx?$/u.test(file))
    return 800;
  if (/(?:^|\/)(?:actions?|services?)(?:\/|\.|$)/u.test(file)) return 800;
  if (
    file.endsWith(".tsx") &&
    (/(?:^|\/)(?:page|layout|template|loading|error|not-found)\.tsx$/u.test(
      file,
    ) ||
      file.startsWith("components/") ||
      file.includes("/components/"))
  )
    return 600;
  return null;
}

export function findMaintainabilityIssues(entries, repositoryName) {
  const baseline = OVERSIZED_BASELINE[repositoryName] ?? {};
  return entries.flatMap(({ file: input, lines }) => {
    const file = normalizeRepoPath(input);
    const limit = maintainabilityLimit(file);
    if (limit === null || lines <= limit) return [];
    const reviewedMaximum = baseline[file];
    if (reviewedMaximum !== undefined && lines <= reviewedMaximum) return [];
    return [
      {
        file,
        rule: SOURCE_ORGANIZATION_RULES.MAINTAINABILITY_LIMIT,
        message: `${lines} lines exceeds the ${limit}-line limit${reviewedMaximum ? ` and reviewed baseline ${reviewedMaximum}` : ""}.`,
      },
    ];
  });
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
  const trackedFiles = getTrackedFiles(repoRoot);
  const lineEntries = trackedFiles
    .filter((file) => SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .map((file) => {
      const contents = readFileSync(path.join(repoRoot, file), "utf8");
      return {
        file,
        lines:
          contents === ""
            ? 0
            : contents.split("\n").length - (contents.endsWith("\n") ? 1 : 0),
      };
    });
  const issues = [
    ...findSourceOrganizationIssues(trackedFiles),
    ...findMaintainabilityIssues(lineEntries, path.basename(repoRoot)),
  ].sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.rule.localeCompare(right.rule),
  );

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
