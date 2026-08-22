#!/usr/bin/env node
/**
 * Enumerate the host modules each private plugin compiles against.
 *
 * The private repository's CI type checks plugins against the host at its
 * current tip, so an import of a host module that only exists in an unmerged
 * host pull request fails there as an opaque module-resolution error, inside a
 * pair of pull requests that block each other. Recording the surface turns that
 * into a named, actionable failure and makes growth visible.
 *
 * Writes `lib/plugins/host-build-surface.generated.json`. Run with `--check` to
 * verify the committed file still matches the tree instead of rewriting it.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { collectHostImportSpecifiers } from "./host-import-specifiers.mjs";
import { collectPluginSourceFiles } from "./plugin-source-files.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const pluginsRoot = join(repositoryRoot, "lib/plugins/private/plugins");
const outputPath = join(
  repositoryRoot,
  "lib/plugins/host-build-surface.generated.json",
);

function collect() {
  const surface = {};

  for (const pluginKey of readdirSync(pluginsRoot).sort()) {
    const pluginDirectory = join(pluginsRoot, pluginKey);
    if (!statSync(pluginDirectory).isDirectory()) continue;

    const specifiers = new Set();
    for (const file of collectPluginSourceFiles(pluginDirectory)) {
      const source = readFileSync(file, "utf8");
      for (const specifier of collectHostImportSpecifiers(source))
        specifiers.add(specifier);
    }

    surface[pluginKey] = [...specifiers].sort();
  }

  return surface;
}

function serialize(surface) {
  return `${JSON.stringify(surface, null, 2)}\n`;
}

const surface = collect();
const serialized = serialize(surface);

if (process.argv.includes("--check")) {
  let committed = "";
  try {
    committed = readFileSync(outputPath, "utf8");
  } catch {
    console.error(
      `[host-build-surface] FAIL: ${relative(repositoryRoot, outputPath)} is missing. Run: bun run plugin:surface:generate`,
    );
    process.exit(1);
  }

  if (committed !== serialized) {
    console.error(
      "[host-build-surface] FAIL: the recorded host build surface no longer matches the plugin sources.",
    );
    for (const [pluginKey, specifiers] of Object.entries(surface)) {
      const previous = new Set(JSON.parse(committed)[pluginKey] ?? []);
      const added = specifiers.filter((entry) => !previous.has(entry));
      const removed = [...previous].filter(
        (entry) => !specifiers.includes(entry),
      );
      if (added.length) {
        console.error(`  ${pluginKey} added: ${added.join(", ")}`);
      }
      if (removed.length) {
        console.error(`  ${pluginKey} removed: ${removed.join(", ")}`);
      }
    }
    console.error("Run: bun run plugin:surface:generate");
    process.exit(1);
  }

  const total = Object.values(surface).reduce(
    (sum, entries) => sum + entries.length,
    0,
  );
  console.log(
    `[host-build-surface] PASS: ${Object.keys(surface).length} plugins declare ${total} host modules.`,
  );
  process.exit(0);
}

writeFileSync(outputPath, serialized);
console.log(
  `[host-build-surface] wrote ${relative(repositoryRoot, outputPath)}`,
);
