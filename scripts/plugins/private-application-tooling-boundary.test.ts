import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "../..");
const childAppsPath = "lib/plugins/private/apps";

function read(relativePath: string): string {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

describe("private application tooling ownership", () => {
  test("one developer command runs the complete plugin verification set", () => {
    const packageJson = JSON.parse(read("package.json")) as {
      scripts?: Record<string, string>;
    };
    const command = packageJson.scripts?.["plugin:verify"];
    const strictCommand = packageJson.scripts?.["plugin:verify:strict"];

    expect(command).toBe(
      "bun run plugin:submodules:check && bun run plugin:check:boundary && bun run plugin:sdk:test && bun run plugin:test:release-integration && bun run plugin:apps:check && bun run test:private-plugins",
    );
    expect(strictCommand).toBe(
      "bun run plugin:submodules:check:strict && bun run plugin:check:boundary && bun run plugin:sdk:test && bun run plugin:test:release-integration && bun run plugin:apps:check && bun run test:private-plugins",
    );
  });

  test("the private candidate CI path runs the independent application gates", () => {
    const packageJson = JSON.parse(read("package.json")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.["test:plugins"]).toContain(
      "plugin:apps:check",
    );

    const workflow = read(".github/workflows/ci.yml");
    expect(workflow).toContain("bun run plugin:apps:check");
    expect(workflow).toContain("bun run plugin:apps:check -- --install-only");
    expect(workflow).not.toContain(
      "bun install --frozen-lockfile --cwd lib/plugins/private/apps/csf",
    );
  });

  test("child gates cannot inherit developer home credentials or run install scripts", () => {
    const checker = read(
      "scripts/plugins/check-private-application-packages.mjs",
    );
    expect(checker).not.toMatch(/^\s*"HOME",$/mu);
    expect(checker).toContain(
      'mkdtempSync(\n    join(tmpdir(), "lets-assist-plugin-app-gates-"),',
    );
    expect(checker).toContain("HOME: homeDirectory");
    expect(checker).toContain("XDG_CACHE_HOME: cacheDirectory");
    expect(checker).toContain(
      'BUN_INSTALL_CACHE_DIR: join(cacheDirectory, "bun-install")',
    );
    expect(checker).toContain('"--ignore-scripts"');
    expect(checker).toContain(
      "rmSync(homeDirectory, { recursive: true, force: true })",
    );
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

  test("private candidates can run isolated private tests before publication", () => {
    const packageJson = JSON.parse(read("package.json")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.["test:private-plugins"]).toBe(
      "node scripts/run-tests.mjs --private-only",
    );

    const runner = read("scripts/run-tests.mjs");
    expect(runner).toContain('"--private-only"');
    expect(runner).toContain('file.startsWith("lib/plugins/private/")');
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
