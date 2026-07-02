type PluginDefinition = {
  manifest?: {
    key?: string;
  };
};

export {};

const { privatePlugins } = await import("../../lib/plugins/private/registry");

const pluginKeys = (privatePlugins as PluginDefinition[])
  .map((plugin) => plugin.manifest?.key)
  .filter((key): key is string => typeof key === "string")
  .sort();

const hasDvPlugin = pluginKeys.includes("dv-speech-debate");

if (hasDvPlugin) {
  throw new Error(
    "Expected dv-speech-debate to be absent while the plugin_data backend is redesigned.",
  );
}

const requiredDefaultPlugins = [
  "calendar-tools",
  "community-impact-radar",
  "dvhs-csf",
  "family-liaison-workbench",
];

for (const requiredPlugin of requiredDefaultPlugins) {
  if (!pluginKeys.includes(requiredPlugin)) {
    throw new Error(`Expected ${requiredPlugin} to be registered.`);
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      dvDisabled: true,
      pluginKeys,
    },
    null,
    2,
  ),
);
