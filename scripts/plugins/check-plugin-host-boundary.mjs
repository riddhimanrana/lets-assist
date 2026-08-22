#!/usr/bin/env node
/**
 * Enforce the plugin/host import boundary.
 *
 * The rule is a ratchet, not a migration. Plugins import 111 host modules
 * today; declaring that category "closed" would be a policy no one could
 * follow, so the committed surface file is a frozen allowlist: everything
 * already there keeps working, and anything new fails until it is a deliberate,
 * reviewed addition.
 *
 * Two rules sit on top of the freeze:
 *
 * - `@/app/**` is closed outright. Reaching into host route internals is not a
 *   dependency a plugin can hold across a deployment boundary. One such import
 *   exists and is recorded below so it cannot multiply.
 * - Application-profile plugins must import nothing from the host. They deploy
 *   separately, so a host import is not a coupling smell but a build failure
 *   waiting to happen.
 *
 * Run against the same host revision CI uses. Checking a local worktree that
 * happens to contain an unmerged host module reports green for exactly the
 * situation that breaks the private repository's pipeline.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { collectHostImportSpecifiers } from "./host-import-specifiers.mjs";
import { collectPluginSourceFiles } from "./plugin-source-files.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const pluginsRoot = join(repositoryRoot, "lib/plugins/private/plugins");
const surfacePath = join(
  repositoryRoot,
  "lib/plugins/host-build-surface.generated.json",
);

/**
 * Plugins that deploy as their own application. They must import no host
 * modules at all. Empty today; Phase 3 adds the first entry.
 */
const APPLICATION_PROFILE_PLUGINS = new Set([]);

/**
 * The single pre-existing `@/app` import. Recorded so the category stays closed
 * to everything else rather than being quietly reopened.
 */
const GRANDFATHERED_APP_IMPORTS = new Set([
  "@/app/organization/[id]/settings/actions",
]);

function collectByPlugin() {
  const byPlugin = new Map();

  for (const pluginKey of readdirSync(pluginsRoot).sort()) {
    const pluginDirectory = join(pluginsRoot, pluginKey);
    if (!statSync(pluginDirectory).isDirectory()) continue;

    const specifiers = new Map();
    for (const file of collectPluginSourceFiles(pluginDirectory)) {
      const source = readFileSync(file, "utf8");
      for (const specifier of collectHostImportSpecifiers(source, {
        sourceFile: file,
        privateRoot: join(repositoryRoot, "lib/plugins/private"),
        repositoryRoot,
      })) {
        const relativeFile = file.slice(repositoryRoot.length + 1);
        if (!specifiers.has(specifier)) specifiers.set(specifier, relativeFile);
      }
    }

    byPlugin.set(pluginKey, specifiers);
  }

  return byPlugin;
}

let frozen;
try {
  frozen = JSON.parse(readFileSync(surfacePath, "utf8"));
} catch {
  console.error(
    "[plugin-host-boundary] FAIL: the recorded host build surface is missing. Run: bun run plugin:surface:generate",
  );
  process.exit(1);
}

const failures = [];
const stale = [];

for (const [pluginKey, specifiers] of collectByPlugin()) {
  const allowed = new Set(frozen[pluginKey] ?? []);
  const isApplicationProfile = APPLICATION_PROFILE_PLUGINS.has(pluginKey);

  for (const [specifier, file] of specifiers) {
    if (isApplicationProfile) {
      failures.push(
        `${pluginKey}: ${specifier} (${file}) — application-profile plugins deploy separately and must import no host modules`,
      );
      continue;
    }

    if (
      specifier.startsWith("@/app/") &&
      !GRANDFATHERED_APP_IMPORTS.has(specifier)
    ) {
      failures.push(
        `${pluginKey}: ${specifier} (${file}) — host route internals are closed to plugins`,
      );
      continue;
    }

    if (!allowed.has(specifier)) {
      failures.push(
        `${pluginKey}: ${specifier} (${file}) — new host import. If deliberate, land the host module first, then run: bun run plugin:surface:generate`,
      );
    }
  }

  for (const specifier of allowed) {
    if (!specifiers.has(specifier)) {
      stale.push(`${pluginKey}: ${specifier}`);
    }
  }
}

for (const entry of stale) {
  console.warn(`[plugin-host-boundary] no longer imported: ${entry}`);
}
if (stale.length > 0) {
  console.warn(
    "[plugin-host-boundary] the recorded surface is wider than reality. Run: bun run plugin:surface:generate",
  );
}

if (failures.length > 0) {
  console.error("[plugin-host-boundary] FAIL:");
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(
    "\nThe private repository type checks plugins against the host at its current tip, so an\nimport of a host module that is not on the host's default branch fails there as an opaque\nmodule-resolution error inside a pair of pull requests that block each other.",
  );
  process.exit(1);
}

const total = [...Object.values(frozen)].reduce(
  (sum, entries) => sum + entries.length,
  0,
);
console.log(
  `[plugin-host-boundary] PASS: no new host imports beyond the ${total} recorded modules.`,
);
