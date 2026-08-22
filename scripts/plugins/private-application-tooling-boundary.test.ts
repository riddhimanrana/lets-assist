import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "../..");
const childAppsPath = "lib/plugins/private/apps";

function read(relativePath: string): string {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

describe("private application tooling ownership", () => {
  test("the private candidate CI path runs the independent application gates", () => {
    const packageJson = JSON.parse(read("package.json")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.["test:plugins"]).toContain(
      "plugin:apps:check",
    );

    const workflow = read(".github/workflows/ci.yml");
    expect(workflow).toContain("bun run plugin:apps:check");
  });

  test("the host compiler and linter exclude child-owned packages", () => {
    const tsconfig = JSON.parse(read("tsconfig.json")) as {
      exclude?: string[];
    };
    expect(tsconfig.exclude).toContain(childAppsPath);
    expect(tsconfig.exclude).toContain("**/node_modules");
    expect(read("eslint.config.mjs")).toContain(`"${childAppsPath}/**"`);
  });

  test("host unit discovery leaves child tests to the child package", () => {
    const runner = read("scripts/run-tests.mjs");
    const sharedIgnore = runner.match(
      /const sharedDiscoveryIgnore = \[([\s\S]*?)\];/u,
    );
    expect(sharedIgnore).not.toBeNull();
    expect(sharedIgnore?.[1]).toContain(`"${childAppsPath}/**"`);
  });

  test("host data and route audits exclude only the independently gated child", () => {
    const dataAudit = read("scripts/audit-plugin-data-access.sh");
    expect(dataAudit).toContain(`-not -path '${childAppsPath}/*'`);
    expect(dataAudit).not.toContain(`-not -path './${childAppsPath}/*'`);
    expect(read("scripts/generate-audit-surface-inventory.mjs")).toContain(
      `"${childAppsPath}/**"`,
    );
  });
});
