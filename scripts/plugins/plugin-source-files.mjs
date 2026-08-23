import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const EXECUTABLE_MODULE_EXTENSION = /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/u;
const APPLICATION_DEPENDENCY_EXTENSION =
  /\.(?:cjs|css|cts|js|jsx|mjs|mts|sass|scss|ts|tsx)$/u;

export function isExecutablePluginModule(path) {
  return EXECUTABLE_MODULE_EXTENSION.test(path);
}

export function isPluginApplicationDependencyFile(path) {
  return APPLICATION_DEPENDENCY_EXTENSION.test(path);
}

export function collectPluginSourceFiles(directory) {
  const found = [];

  for (const entry of readdirSync(directory)) {
    if ([".next", ".turbo", "dist", "node_modules"].includes(entry)) continue;
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      found.push(...collectPluginSourceFiles(absolute));
      continue;
    }
    if (isExecutablePluginModule(entry)) found.push(absolute);
  }

  return found;
}

export function collectPluginApplicationDependencyFiles(directory) {
  const found = [];

  for (const entry of readdirSync(directory)) {
    if ([".next", ".turbo", "dist", "node_modules"].includes(entry)) continue;
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      found.push(...collectPluginApplicationDependencyFiles(absolute));
      continue;
    }
    if (isPluginApplicationDependencyFile(entry)) found.push(absolute);
  }

  return found;
}
