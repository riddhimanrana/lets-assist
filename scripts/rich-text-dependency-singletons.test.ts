import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * Tiptap breaks when more than one copy of a ProseMirror package is loaded:
 * `instanceof` checks across copies fail and the editor reports
 * "Can not convert <> to a Fragment". A duplicate is invisible in source
 * review, so the lockfile is the gate.
 */
const lockfile = readFileSync(new URL("../bun.lock", import.meta.url), "utf8");
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { overrides?: Record<string, string> };

const RESOLUTION_PATTERN = /"((?:@[^"@/]+\/)?[^"@/]+)@([0-9][^"]*)"/g;

function resolvedVersionsByPackage(
  matches: (name: string) => boolean,
): Map<string, string[]> {
  const versions = new Map<string, Set<string>>();
  for (const [, name, version] of lockfile.matchAll(RESOLUTION_PATTERN)) {
    if (!matches(name)) continue;
    const seen = versions.get(name) ?? new Set<string>();
    seen.add(version);
    versions.set(name, seen);
  }
  return new Map([...versions].map(([name, seen]) => [name, [...seen].sort()]));
}

function duplicates(versions: Map<string, string[]>): string[] {
  return [...versions]
    .filter(([, resolved]) => resolved.length > 1)
    .map(([name, resolved]) => `${name}: ${resolved.join(", ")}`)
    .sort();
}

describe("rich text editor dependency singletons", () => {
  const prosemirror = resolvedVersionsByPackage((name) =>
    name.startsWith("prosemirror-"),
  );
  const tiptap = resolvedVersionsByPackage((name) =>
    name.startsWith("@tiptap/"),
  );

  test("the lockfile resolves one version of every ProseMirror package", () => {
    expect(prosemirror.size).toBeGreaterThan(0);
    expect(duplicates(prosemirror)).toEqual([]);
  });

  test("the lockfile resolves one version of every Tiptap package", () => {
    expect(tiptap.size).toBeGreaterThan(0);
    expect(duplicates(tiptap)).toEqual([]);
  });

  test("each ProseMirror override pins the version the lockfile resolves", () => {
    const overrides = Object.entries(packageJson.overrides ?? {}).filter(
      ([name]) => name.startsWith("prosemirror-"),
    );

    expect(overrides.length).toBeGreaterThan(0);
    for (const [name, version] of overrides) {
      expect(prosemirror.get(name)).toEqual([version]);
    }
  });
});
