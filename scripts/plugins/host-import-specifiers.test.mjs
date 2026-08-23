import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  collectHostImportSpecifiers,
  collectLiteralApplicationDependencySpecifiers,
  collectLiteralImportSpecifiers,
  collectStylesheetDependencySpecifiers,
  readApplicationCompilerOptions,
  resolveApplicationImportSpecifier,
  resolveEscapingApplicationImportSpecifier,
} from "./host-import-specifiers.mjs";

describe("host import specifier collection", () => {
  test("exposes literal imports for independent application checks", () => {
    expect([
      ...collectLiteralImportSpecifiers('import x from "../../host";'),
    ]).toEqual(["../../host"]);
  });

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

  test("collects dynamic host imports with import attributes", () => {
    const source = `
      const json = import("@/lib/data.json", { with: { type: "json" } });
      const template = import(\`@/lib/template.json\`, {
        with: { type: "json" },
      });
    `;

    expect([...collectHostImportSpecifiers(source)].sort()).toEqual([
      "@/lib/data.json",
      "@/lib/template.json",
    ]);
  });

  test("collects dynamic imports with bundler comments before the literal", () => {
    const source = `
      const chunk = import(/* webpackChunkName: "host" */ "@/lib/chunk");
      const template = import(
        // Keep this chunk name stable.
        \`@/lib/template-chunk\`
      );
    `;

    expect([...collectHostImportSpecifiers(source)].sort()).toEqual([
      "@/lib/chunk",
      "@/lib/template-chunk",
    ]);
  });

  test("scans adversarial comment sequences without regular-expression backtracking", () => {
    const noise = "/* */".repeat(10_000);
    const source = `
      const ignored = import(${noise} "react");
      const host = import(${noise} "@/lib/after-noise");
    `;

    expect([...collectHostImportSpecifiers(source)]).toEqual([
      "@/lib/after-noise",
    ]);
  });

  test("decodes escaped host and escaping-relative module specifiers", () => {
    const repositoryRoot = "/work/lets-assist";
    const privateRoot = join(repositoryRoot, "lib/plugins/private");
    const sourceFile = join(privateRoot, "plugins/example/feature/index.ts");
    const source = String.raw`
      import host from "@\x2flib/escaped-host";
      const relative = import("\u002e\u002e/\u002e\u002e/\u002e\u002e/\u002e\u002e/registry");
    `;

    expect(
      [
        ...collectHostImportSpecifiers(source, {
          sourceFile,
          privateRoot,
          repositoryRoot,
        }),
      ].sort(),
    ).toEqual(["@/lib/escaped-host", "@/lib/plugins/registry"]);
  });

  test("accepts comments between CommonJS call tokens", () => {
    const source = `
      const host = require /* bundler */ (/* keep */ "@/lib/commented");
    `;

    expect([...collectHostImportSpecifiers(source)]).toEqual([
      "@/lib/commented",
    ]);
  });

  test("accepts comments before static import and export specifiers", () => {
    const source = `
      import value from /* bundler */ "@/lib/static-import";
      import /* setup */ "@/lib/side-effect";
      export { value } from /* stable */ "@/lib/static-export";
    `;

    expect([...collectHostImportSpecifiers(source)].sort()).toEqual([
      "@/lib/side-effect",
      "@/lib/static-export",
      "@/lib/static-import",
    ]);
  });

  test("collects TypeScript import-equals host dependencies", () => {
    const source = `
      import host = require("@/lib/import-equals");
      import external = require("external-package");
    `;

    expect([...collectHostImportSpecifiers(source)]).toEqual([
      "@/lib/import-equals",
    ]);
  });

  test("collects TypeScript type-position import dependencies", () => {
    const source = `
      type Host = import("@/lib/type-host").Host;
      type HostModule = typeof import("@/lib/type-module");
      type External = import("external-package").External;
    `;

    expect([...collectHostImportSpecifiers(source)].sort()).toEqual([
      "@/lib/type-host",
      "@/lib/type-module",
    ]);
  });

  test("collects TypeScript path reference directives", () => {
    const source = `
      /// <reference path="../../outside/host.d.ts" />
      /// <reference types="node" />
      export type Local = string;
    `;

    expect([...collectLiteralApplicationDependencySpecifiers(source)]).toEqual([
      "../../outside/host.d.ts",
    ]);
  });

  test("resolves child path aliases before classifying them as packages", () => {
    const root = mkdtempSync(join(tmpdir(), "plugin-import-alias-"));
    try {
      const applicationRoot = join(root, "private/apps/example");
      const applicationSource = join(applicationRoot, "src/index.ts");
      const hostSource = join(root, "host/new-host.ts");
      mkdirSync(join(applicationRoot, "src"), { recursive: true });
      mkdirSync(join(root, "host"), { recursive: true });
      writeFileSync(applicationSource, 'import "host/new-host";\n');
      writeFileSync(hostSource, "export type Host = string;\n");
      writeFileSync(
        join(applicationRoot, "tsconfig.json"),
        `${JSON.stringify(
          {
            compilerOptions: {
              baseUrl: ".",
              module: "esnext",
              moduleResolution: "bundler",
              paths: { "host/*": ["../../../host/*"] },
            },
            include: ["src/**/*.ts"],
          },
          null,
          2,
        )}\n`,
      );

      const options = readApplicationCompilerOptions(applicationRoot);
      expect(
        resolveApplicationImportSpecifier(
          "host/new-host",
          applicationSource,
          options,
        ),
      ).toBe(hostSource);
      expect(
        resolveEscapingApplicationImportSpecifier(
          "host/new-host",
          applicationSource,
          applicationRoot,
          options,
        ),
      ).toBe(hostSource);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("collects literal CommonJS resolution dependencies", () => {
    const source = `
      const resolved = require.resolve("@/lib/resolved-host");
      const weak = require.resolveWeak("@/lib/weak-host");
      const loaded = module.require("@/lib/module-host");
      const external = require.resolve("external-package");
    `;

    expect([...collectHostImportSpecifiers(source)].sort()).toEqual([
      "@/lib/module-host",
      "@/lib/resolved-host",
      "@/lib/weak-host",
    ]);
  });

  test("collects URL-based and import-meta build dependencies", () => {
    const source = `
      const worker = new URL("../../outside/worker.ts", import.meta.url);
      const local = new URL("./local-worker.ts", import.meta.url);
      const resolved = import.meta.resolve("../../outside/config.json");
      const ignoredOrigin = new URL("../../outside/runtime.txt", baseUrl);
      const ignoredDynamic = new URL(path, import.meta.url);
    `;

    expect(
      [...collectLiteralApplicationDependencySpecifiers(source)].sort(),
    ).toEqual([
      "../../outside/config.json",
      "../../outside/worker.ts",
      "./local-worker.ts",
    ]);
    expect([...collectLiteralImportSpecifiers(source)]).toEqual([
      "../../outside/config.json",
    ]);
  });

  test("collects CSS and Sass dependency specifiers", () => {
    const source = `
      /* @import "../../ignored.css"; */
      /* .ignored { background: url("../../ignored.png"); } */
      @import "../../outside/host.css";
      @import url('../local.css');
      @import url(../../outside/print.css) print;
      @use "../../outside/tokens" as tokens;
      @forward './local-theme';
      @use "../../outside/indented-sass"
      .hero { background: url("../../outside/hero.png"); }
      @font-face { src: url(../../outside/font.woff2) format("woff2"); }
      .local { mask-image: url('./mask.svg'); }
      .embedded { background: url(data:image/png;base64,abc); }
      .remote { background: url("https://cdn.example.com/image.png"); }
      .protocol-relative { background: url(//cdn.example.com/image.png); }
      .fragment { filter: url('#shadow'); }
    `;

    expect([...collectStylesheetDependencySpecifiers(source)].sort()).toEqual([
      "../../outside/font.woff2",
      "../../outside/hero.png",
      "../../outside/host.css",
      "../../outside/indented-sass",
      "../../outside/print.css",
      "../../outside/tokens",
      "../local.css",
      "./local-theme",
      "./mask.svg",
    ]);
  });

  test("collects literal Webpack context dependency roots", () => {
    const source = `
      const host = require.context("@/lib/context-host", true, /\\.tsx$/);
      const relative = require.context("../../../../registry", false);
      const external = require.context("external-package", false);
    `;
    const repositoryRoot = "/work/lets-assist";
    const privateRoot = join(repositoryRoot, "lib/plugins/private");
    const sourceFile = join(privateRoot, "plugins/example/feature/index.ts");

    expect(
      [
        ...collectHostImportSpecifiers(source, {
          sourceFile,
          privateRoot,
          repositoryRoot,
        }),
      ].sort(),
    ).toEqual(["@/lib/context-host", "@/lib/plugins/registry"]);
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
