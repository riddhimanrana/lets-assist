import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");
const manifest = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf8"),
) as {
  dependencies?: Record<string, string>;
  overrides?: Record<string, string>;
};

describe("fresh-install dependency resolution", () => {
  test("keeps application Ajv 8 separate from ESLint's Ajv 6 contract", () => {
    expect(manifest.dependencies?.ajv).toBe("8.20.0");
    expect(manifest.overrides).not.toHaveProperty("ajv");

    const appRequire = createRequire(join(repositoryRoot, "package.json"));
    const eslintRequire = createRequire(
      appRequire.resolve("@eslint/eslintrc/package.json"),
    );
    const appVersion = appRequire("ajv/package.json").version as string;
    const eslintVersion = eslintRequire("ajv/package.json").version as string;

    expect(appVersion).toBe("8.20.0");
    expect(eslintVersion).toMatch(/^6\./);
  });
});
