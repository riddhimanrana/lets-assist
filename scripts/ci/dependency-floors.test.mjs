import { readFileSync } from "node:fs";
import { JSONC } from "bun";
import { describe, expect, test } from "bun:test";

const manifest = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);
const lock = JSONC.parse(
  readFileSync(new URL("../../bun.lock", import.meta.url), "utf8"),
);

// GHSA-vcvr-r3jv-pc5j fixes Node ImageResponse SVG processing in 16.3.6.
// Keep the reviewed 16.4 line while preserving the earlier patched floor.
const minimumNextPatchByMinor = new Map([
  [3, 6],
  [4, 0],
]);

function isReviewedPatchedNext(version) {
  if (typeof version !== "string") return false;
  const match = /^16\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(version);
  if (!match) return false;
  const minor = Number(match[1]);
  const patch = Number(match[2]);
  const minimumPatch = minimumNextPatchByMinor.get(minor);
  return (
    Number.isSafeInteger(minor) &&
    Number.isSafeInteger(patch) &&
    minimumPatch !== undefined &&
    patch >= minimumPatch
  );
}

function resolvedNextVersions(packages) {
  return Object.values(packages)
    .filter(
      (entry) =>
        Array.isArray(entry) &&
        typeof entry[0] === "string" &&
        entry[0].startsWith("next@"),
    )
    .map((entry) => entry[0].slice("next@".length));
}

describe("Next.js security patch policy", () => {
  test.each(["16.3.6", "16.3.12", "16.4.0", "16.4.12"])(
    "accepts reviewed stable release %s",
    (version) => {
      expect(isReviewedPatchedNext(version)).toBe(true);
    },
  );

  test.each([
    "16.3.5",
    "16.2.99",
    "15.5.99",
    "17.0.0",
    "16.5.0",
    "16.4.0-canary.1",
    "16.4.0-rc.0",
    "16.4.0+build.1",
    "16.04.0",
    "16.4.00",
    "^16.4.0",
    "~16.4.0",
    "16.4.x",
    "latest",
    "16.4.0 ",
    "16.4.9007199254740992",
    "",
    null,
    undefined,
  ])("rejects unsafe or unreviewed version %s", (version) => {
    expect(isReviewedPatchedNext(version)).toBe(false);
  });

  test("inspects nested and prerelease resolutions without confusing package names or dependency ranges", () => {
    expect(
      resolvedNextVersions({
        next: ["next@16.4.0", "", { dependencies: { next: "^16.4.0" } }],
        "email/next": ["next@16.3.5", "", {}],
        "preview/next": ["next@16.4.1-canary.0", "", {}],
        "next-sitemap": ["next-sitemap@4.2.3", "", {}],
        "@next/env": ["@next/env@16.4.0", "", {}],
      }),
    ).toEqual(["16.4.0", "16.3.5", "16.4.1-canary.0"]);
  });
  test("pins the patched release line and keeps companion packages aligned", () => {
    const version = manifest.dependencies.next;
    expect(isReviewedPatchedNext(version)).toBe(true);
    expect(lock.packages.next?.[0]).toBe(`next@${version}`);
    for (const name of [
      "@next/env",
      "@next/eslint-plugin-next",
      "eslint-config-next",
    ]) {
      expect(manifest.devDependencies[name]).toBe(version);
      expect(lock.packages[name]?.[0]).toBe(`${name}@${version}`);
    }
    expect(manifest.overrides.next).toBe(version);
  });

  test("does not retain an older transitive Next.js resolution", () => {
    const versions = resolvedNextVersions(lock.packages);
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
