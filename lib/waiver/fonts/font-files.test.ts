import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { UNICODE_FONT_FILES, UNICODE_FONT_TRACE_GLOBS } from "./font-files";

const root = process.cwd();
const manifest = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
) as {
  dependencies: Record<string, string>;
};

describe("bundled waiver fonts", () => {
  test.each(UNICODE_FONT_FILES.map((file) => [file.id, file] as const))(
    "%s is an installed, pinned, openly licensed TrueType file",
    (_id, file) => {
      const fontPath = join(root, file.path);
      expect(existsSync(fontPath)).toBe(true);
      // TrueType outlines: version 0x00010000.
      expect(readFileSync(fontPath).subarray(0, 4).toString("hex")).toBe(
        "00010000",
      );

      const packageRoot = dirname(dirname(fontPath));
      const packageName = file.path.split("/").slice(1, 3).join("/");
      expect(manifest.dependencies[packageName]).toMatch(/^\d+\.\d+\.\d+$/u);
      expect(
        JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"))
          .license,
      ).toBe("MIT AND OFL-1.1");
      expect(readFileSync(join(packageRoot, "LICENSE_FONT"), "utf8")).toContain(
        "SIL OPEN FONT LICENSE Version 1.1",
      );
    },
  );

  test("the files add less than 20 MB to the waiver routes", () => {
    const total = UNICODE_FONT_FILES.reduce(
      (bytes, file) => bytes + statSync(join(root, file.path)).size,
      0,
    );
    expect(total).toBeLessThan(20_000_000);
  });

  test("both waiver routes trace every font file into their bundle", () => {
    expect(UNICODE_FONT_TRACE_GLOBS).toEqual(
      UNICODE_FONT_FILES.map((file) => `./${file.path}`),
    );
    const config = readFileSync(join(root, "next.config.ts"), "utf8");
    expect(config).toContain(
      '"/api/waivers/*/preview": UNICODE_FONT_TRACE_GLOBS',
    );
    expect(config).toContain(
      '"/api/waivers/*/download": UNICODE_FONT_TRACE_GLOBS',
    );
    for (const route of ["preview", "download"]) {
      const source = readFileSync(
        join(root, `app/api/waivers/[signatureId]/${route}/route.ts`),
        "utf8",
      );
      // The fonts are read with node:fs, so the routes must stay on Node.js.
      expect(source).not.toMatch(/runtime\s*=\s*["']edge["']/u);
    }
  });

  test("the font engine is pinned to the version its subset fix was written for", () => {
    expect(manifest.dependencies["@pdf-lib/fontkit"]).toBe("1.1.1");
    expect(manifest.dependencies["regenerator-runtime"]).toMatch(
      /^\d+\.\d+\.\d+$/u,
    );
  });
});
