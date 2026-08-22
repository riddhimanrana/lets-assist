import { describe, expect, test } from "bun:test";

import { isExecutablePluginModule } from "./plugin-source-files.mjs";

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
});
