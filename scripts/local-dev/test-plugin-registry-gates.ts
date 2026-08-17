import { mock } from "bun:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { publishedPluginReleases } from "../../lib/plugins/published-releases";

type PluginDefinition = {
  manifest?: {
    key?: string;
    version?: string;
  };
};

export {};

// `server-only` intentionally throws outside a React Server Component build.
// This script audits registry metadata in Bun, so replace only that marker.
mock.module("server-only", () => ({}));

const { privatePlugins } = await import("../../lib/plugins/private/registry");

const pluginKeys = (privatePlugins as PluginDefinition[])
  .map((plugin) => plugin.manifest?.key)
  .filter((key): key is string => typeof key === "string")
  .sort();

const hasDvPlugin = pluginKeys.includes("dv-speech-debate");

if (!hasDvPlugin) {
  throw new Error(
    "Expected the server-only dv-speech-debate plugin to be registered.",
  );
}

// The two real products. calendar-tools, community-impact-radar and
// family-liaison-workbench were example plugins seeded for visibility-tier
// testing and have been removed.
const requiredDefaultPlugins = ["dv-speech-debate", "dvhs-csf"];

for (const requiredPlugin of requiredDefaultPlugins) {
  if (!pluginKeys.includes(requiredPlugin)) {
    throw new Error(`Expected ${requiredPlugin} to be registered.`);
  }
}

const repositoryRoot = resolve(import.meta.dir, "../..");
const privateRoot = resolve(repositoryRoot, "lib/plugins/private");
const definitionsByKey = new Map(
  (privatePlugins as PluginDefinition[]).map((definition) => [
    definition.manifest?.key,
    definition,
  ]),
);
const releaseKeys = publishedPluginReleases
  .map((release) => release.pluginKey)
  .sort();

if (JSON.stringify(releaseKeys) !== JSON.stringify(pluginKeys)) {
  throw new Error(
    `Published release registry does not match runtime registry: releases=${releaseKeys.join(",")} runtime=${pluginKeys.join(",")}`,
  );
}

for (const release of publishedPluginReleases) {
  const definition = definitionsByKey.get(release.pluginKey);
  if (definition?.manifest?.version !== release.version) {
    throw new Error(
      `${release.pluginKey} manifest version ${definition?.manifest?.version ?? "missing"} does not match published ${release.version}`,
    );
  }

  const manifestBytes = readFileSync(
    resolve(privateRoot, release.manifestFile),
  );
  const actualHash = createHash("sha256").update(manifestBytes).digest("hex");
  if (actualHash !== release.manifestHash) {
    throw new Error(
      `${release.pluginKey} manifest hash drifted: expected ${release.manifestHash}, received ${actualHash}`,
    );
  }

  try {
    execFileSync(
      "git",
      [
        "-C",
        privateRoot,
        "merge-base",
        "--is-ancestor",
        release.sourceCommit,
        "HEAD",
      ],
      { stdio: "ignore" },
    );
  } catch {
    throw new Error(
      `${release.pluginKey} published source ${release.sourceCommit} is not contained in the private gitlink`,
    );
  }

  if (release.automaticUpdate || release.rolloutPercentage !== 0) {
    throw new Error(
      `${release.pluginKey} cannot auto-update until a reviewed compatibility rollout is published`,
    );
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      dvEnabled: true,
      pluginKeys,
      publishedReleases: publishedPluginReleases.length,
    },
    null,
    2,
  ),
);
