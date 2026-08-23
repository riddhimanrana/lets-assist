import { describe, expect, test } from "bun:test";

import {
  isExecutablePluginModule,
  isPluginApplicationDependencyFile,
} from "./plugin-source-files.mjs";

describe("plugin source file discovery", () => {
  test("includes every executable JavaScript and TypeScript module extension", () => {
    for (const extension of [
      "js",
      "jsx",
      "mjs",
      "cjs",
      "ts",
      "tsx",
      "mts",
      "cts",
    ]) {
      expect(isExecutablePluginModule(`plugin.${extension}`)).toBe(true);
    }
  });

  test("excludes non-executable source assets", () => {
    for (const path of ["manifest.json", "styles.css", "README.md"]) {
      expect(isExecutablePluginModule(path)).toBe(false);
    }
  });

  test("includes stylesheets in an application dependency scan", () => {
    for (const path of ["styles.css", "theme.scss", "tokens.sass"]) {
      expect(isPluginApplicationDependencyFile(path)).toBe(true);
    }
    expect(isPluginApplicationDependencyFile("README.md")).toBe(false);
  });
});
