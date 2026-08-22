import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const EXECUTABLE_MODULE_EXTENSION = /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/u;

export function isExecutablePluginModule(path) {
  return EXECUTABLE_MODULE_EXTENSION.test(path);
}

export function collectPluginSourceFiles(directory) {
  const found = [];

  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules") continue;
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      found.push(...collectPluginSourceFiles(absolute));
      continue;
    }
    if (isExecutablePluginModule(entry)) found.push(absolute);
  }

  return found;
}
