import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The SDK is meant to be consumed by a plugin that deploys as its own
 * application, in a different repository, without the host's module graph. That
 * only holds if nothing here reaches into the host.
 *
 * Enforcing it mechanically matters more than it looks: a single convenience
 * import of a Supabase client or a host service would compile fine in this
 * repository and fail only once someone tried to package the SDK, by which
 * point the dependency would be load-bearing.
 */

/**
 * Scope is `sdk/v1` deliberately, not all of `sdk/`.
 *
 * `sdk/v1` is the portable contract: it must survive being consumed by a plugin
 * that has no host module graph. `sdk/adapters` is the opposite by design — an
 * adapter's whole job is to bridge host types to the contract, so it imports
 * host code and is not portable. Scanning both would either fail honestly or
 * force the adapters to be excluded case by case, which would erode the rule.
 */
const sdkRoot = join(import.meta.dir);

const FORBIDDEN_SPECIFIER_PATTERNS: Array<{ pattern: RegExp; why: string }> = [
  {
    pattern: /^react$|^react\//u,
    why: "React would make the manifest unserializable",
  },
  { pattern: /^next$|^next\//u, why: "Next.js is a host runtime detail" },
  { pattern: /^@supabase\//u, why: "the SDK must not bind a database client" },
  {
    pattern: /^server-only$/u,
    why: "the SDK is consumed by non-host servers too",
  },
  { pattern: /^@\//u, why: "host modules are not available to a packaged SDK" },
  {
    pattern: /^\.\.\/\.\./u,
    why: "reaching above lib/plugins/sdk leaves the SDK",
  },
];

const IMPORT_PATTERN =
  /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/gu;
const REQUIRE_PATTERN = /\brequire\(\s*["']([^"']+)["']\s*\)/gu;
const DYNAMIC_IMPORT_PATTERN = /\bimport\(\s*["']([^"']+)["']\s*\)/gu;

function sdkSourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      found.push(...sdkSourceFiles(absolute));
      continue;
    }
    if (!/\.tsx?$/u.test(entry)) continue;
    if (/\.test\.tsx?$/u.test(entry)) continue;
    found.push(absolute);
  }
  return found;
}

function specifiersIn(source: string): string[] {
  const specifiers: string[] = [];
  for (const pattern of [
    IMPORT_PATTERN,
    REQUIRE_PATTERN,
    DYNAMIC_IMPORT_PATTERN,
  ]) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

describe("plugin SDK purity", () => {
  const files = sdkSourceFiles(sdkRoot);

  test("there are SDK source files to check", () => {
    // Guards against the traversal silently finding nothing and the suite
    // passing vacuously.
    expect(files.length).toBeGreaterThan(5);
  });

  test("no SDK module imports host or framework code", () => {
    const violations: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const specifier of specifiersIn(source)) {
        for (const { pattern, why } of FORBIDDEN_SPECIFIER_PATTERNS) {
          if (pattern.test(specifier)) {
            violations.push(`${file}: "${specifier}" — ${why}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("the only third-party dependency is the validator", () => {
    const external = new Set<string>();

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const specifier of specifiersIn(source)) {
        if (specifier.startsWith(".")) continue;
        external.add(specifier.split("/")[0]);
      }
    }

    // Ajv is deliberate: the manifest contract is published as JSON Schema, so
    // the SDK carries the validator that reads it. Anything else appearing here
    // is a new packaging obligation and should be a conscious decision.
    expect([...external].sort()).toEqual(["ajv"]);
  });
});
