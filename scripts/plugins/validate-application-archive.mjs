import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outputRoot = ".vercel/output";
const tracedRoots = [".next", "node_modules"];
const tracedFiles = new Set([".env.example", "package.json"]);

function isInsideOutput(path) {
  return path === outputRoot || path.startsWith(`${outputRoot}/`);
}

function isReviewedBuildPath(path) {
  return (
    isInsideOutput(path) ||
    tracedFiles.has(path) ||
    tracedRoots.some((root) => path === root || path.startsWith(`${root}/`))
  );
}

function reviewedRoot(path) {
  if (isInsideOutput(path)) return outputRoot;
  if (path === ".next" || path.startsWith(".next/")) return ".next";
  if (path === "node_modules" || path.startsWith("node_modules/")) {
    return "node_modules";
  }
  return tracedFiles.has(path) ? path : null;
}

function validatePath(path, label) {
  const withoutTrailingSlash = path.replace(/\/$/u, "");
  if (
    !path ||
    path.includes("\\") ||
    isAbsolute(path) ||
    normalize(withoutTrailingSlash) !== withoutTrailingSlash ||
    !isReviewedBuildPath(withoutTrailingSlash)
  ) {
    throw new Error(`Refusing unsafe ${label}: ${path}`);
  }
}

export function validateApplicationArchiveListings(entriesText, verboseText) {
  const entries = entriesText.trimEnd().split("\n");
  const verboseEntries = verboseText.trimEnd().split("\n");

  if (entries.length !== verboseEntries.length) {
    throw new Error("Archive listings disagree about the entry count");
  }

  const seen = new Set();
  const symlinks = new Map();

  entries.forEach((entry, index) => {
    validatePath(entry, "archive path");
    if (seen.has(entry)) {
      throw new Error(`Refusing duplicate archive path: ${entry}`);
    }
    seen.add(entry);

    const type = verboseEntries[index]?.[0];
    if (type === "-" || type === "d") return;
    if (type !== "l") {
      throw new Error(
        `Refusing archive entry type ${type ?? "unknown"}: ${entry}`,
      );
    }

    const marker = `${entry} -> `;
    const markerIndex = verboseEntries[index].indexOf(marker);
    if (markerIndex === -1) {
      throw new Error(`Cannot validate archive symlink: ${entry}`);
    }

    const target = verboseEntries[index].slice(markerIndex + marker.length);
    if (!target || target.includes("\\") || isAbsolute(target)) {
      throw new Error(`Refusing unsafe archive symlink target: ${entry}`);
    }

    const resolvedTarget = normalize(join(dirname(entry), target));
    const entryRoot = reviewedRoot(entry);
    if (
      tracedFiles.has(entry) ||
      entryRoot === null ||
      reviewedRoot(resolvedTarget) !== entryRoot
    ) {
      throw new Error(`Refusing escaping archive symlink: ${entry}`);
    }
    symlinks.set(entry, resolvedTarget);
  });

  for (const [symlink, target] of symlinks) {
    if (entries.some((entry) => entry.startsWith(`${symlink}/`))) {
      throw new Error(`Refusing archive traversal through symlink: ${symlink}`);
    }
    if (
      [...symlinks.keys()].some(
        (candidate) =>
          target === candidate || target.startsWith(`${candidate}/`),
      )
    ) {
      throw new Error(`Refusing archive symlink chain: ${symlink}`);
    }
  }
}

export function validateApplicationArchive(archivePath) {
  const entries = execFileSync("tar", ["-tzf", archivePath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const verboseEntries = execFileSync("tar", ["-tvzf", archivePath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  validateApplicationArchiveListings(entries, verboseEntries);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const archivePath = process.argv[2];
  if (!archivePath || process.argv.length !== 3) {
    console.error(
      "Usage: node validate-application-archive.mjs <archive.tar.gz>",
    );
    process.exit(1);
  }

  try {
    validateApplicationArchive(archivePath);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
