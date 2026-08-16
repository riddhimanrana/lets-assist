import { mock } from "bun:test";

type PluginDefinition = {
  manifest?: {
    key?: string;
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

console.log(
  JSON.stringify(
    {
      ok: true,
      dvEnabled: true,
      pluginKeys,
    },
    null,
    2,
  ),
);
