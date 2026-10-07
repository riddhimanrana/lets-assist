import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const manifest = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);
const lock = readFileSync(new URL("../../bun.lock", import.meta.url), "utf8");

// GHSA-vcvr-r3jv-pc5j fixes Node ImageResponse SVG processing in 16.3.6.
const minimumNextPatch = 6;

describe("Next.js security patch policy", () => {
  test("pins the patched release line and keeps companion packages aligned", () => {
    const version = manifest.dependencies.next;
    expect(version).toMatch(/^16\.3\.\d+$/u);
    expect(Number(version.split(".")[2])).toBeGreaterThanOrEqual(
      minimumNextPatch,
    );
    for (const name of [
      "@next/env",
      "@next/eslint-plugin-next",
      "eslint-config-next",
    ]) {
      expect(manifest.devDependencies[name]).toBe(version);
    }
    expect(manifest.overrides.next).toBe(version);
  });

  test("does not retain an older transitive Next.js resolution", () => {
    const versions = [...lock.matchAll(/"next@(\d+\.\d+\.\d+)"/gu)].map(
      (match) => match[1],
    );
    expect([...new Set(versions)]).toEqual([manifest.dependencies.next]);
  });
});

test("package shortcuts cannot bypass the reviewed database release and export workflow", () => {
  for (const name of [
    "supabase:pull",
    "supabase:push",
    "supabase:dump:schema",
    "supabase:dump:seed",
  ]) {
    expect(manifest.scripts[name]).toBeUndefined();
  }
});
