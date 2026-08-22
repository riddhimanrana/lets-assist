import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { collectHostImportSpecifiers } from "./host-import-specifiers.mjs";

describe("host import specifier collection", () => {
  test("collects static, side-effect, dynamic, and CommonJS host imports", () => {
    const source = `
      import { first } from "@/lib/first";
      export { second } from "@/lib/second";
      import "@/lib/register-plugin";
      const fourth = import("@/lib/fourth");
      const fifth = require("@/lib/fifth");
      const sixth = import(\`@/lib/sixth\`);
      const seventh = require(\`@/lib/seventh\`);
    `;

    expect([...collectHostImportSpecifiers(source)].sort()).toEqual([
      "@/lib/fifth",
      "@/lib/first",
      "@/lib/fourth",
      "@/lib/register-plugin",
      "@/lib/second",
      "@/lib/seventh",
      "@/lib/sixth",
    ]);
  });

  test("ignores interpolated template-literal specifiers", () => {
    const source = "const plugin = import(`@/lib/${pluginName}`);";

    expect([...collectHostImportSpecifiers(source)]).toEqual([]);
  });

  test("ignores non-host imports", () => {
    const source = `
      import "react";
      import { join } from "node:path";
      const plugin = import("./plugin");
    `;

    expect([...collectHostImportSpecifiers(source)]).toEqual([]);
  });

  test("normalizes relative imports that escape the private tree", () => {
    const repositoryRoot = "/work/lets-assist";
    const privateRoot = join(repositoryRoot, "lib/plugins/private");
    const sourceFile = join(
      privateRoot,
      "plugins/example-plugin/feature/index.ts",
    );
    const source = `
      import local from "./local";
      import shared from "../../../shared";
      import host from "../../../../registry";
    `;

    expect([
      ...collectHostImportSpecifiers(source, {
        sourceFile,
        privateRoot,
        repositoryRoot,
      }),
    ]).toEqual(["@/lib/plugins/registry"]);
  });
});
