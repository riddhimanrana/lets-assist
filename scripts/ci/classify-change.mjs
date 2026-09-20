#!/usr/bin/env node

import process from "node:process";
import { fileURLToPath } from "node:url";

export function requiresFullValidation(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return true;

  return paths.some((input) => {
    const path = input.trim();
    if (!path) return false;
    if (path === "README.md") return false;
    return !(path.startsWith("docs/") && /\.(?:md|mdx)$/u.test(path));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const paths = input.split(/\r?\n/u).filter(Boolean);
  process.stdout.write(
    `full_validation=${requiresFullValidation(paths) ? "true" : "false"}\n`,
  );
}
