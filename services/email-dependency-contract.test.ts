import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The email transport's dependency floor, asserted against the real lockfile.
 *
 * Dependabot alert 101 (GHSA-p6gq-j5cr-w38f) is HIGH against nodemailer <= 9.0.0:
 * a raw `path`/`href` on a message part bypassed the earlier content-access guards,
 * turning any attacker-influenced attachment field into a local-file-read or SSRF
 * primitive. 9.0.1 is the first patched release.
 *
 * A declared range in package.json is not the thing that ships -- the RESOLVED
 * version is. And a single resolution matters as much as the floor: a transitive
 * dependant pinning an old nodemailer would put a vulnerable copy on disk while the
 * direct range still read `^9.0.3`. So this asserts both.
 */

const repositoryRoot = join(import.meta.dir, "..");

function parseSemver(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) throw new Error(`unparseable version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function atLeast(version: string, floor: string): boolean {
  const [aMajor, aMinor, aPatch] = parseSemver(version);
  const [bMajor, bMinor, bPatch] = parseSemver(floor);
  if (aMajor !== bMajor) return aMajor > bMajor;
  if (aMinor !== bMinor) return aMinor > bMinor;
  return aPatch >= bPatch;
}

describe("email transport dependency floor", () => {
  const lockfile = readFileSync(join(repositoryRoot, "bun.lock"), "utf8");

  test("exactly one nodemailer resolves, at or above the patched 9.0.1", () => {
    // Lockfile entries look like:  "nodemailer": ["nodemailer@9.0.3", ...
    const resolutions = [
      ...lockfile.matchAll(/"nodemailer@(\d+\.\d+\.\d+)"/g),
    ].map((match) => match[1]);

    expect(resolutions.length).toBeGreaterThan(0);

    const distinct = [...new Set(resolutions)];
    // More than one resolution means a vulnerable copy can coexist with a patched
    // direct dependency, which is exactly what the alert is about.
    expect(distinct).toHaveLength(1);

    const [resolved] = distinct;
    expect(atLeast(resolved, "9.0.1")).toBe(true);
  });

  test("the declared nodemailer range cannot drift below the patched floor", () => {
    const manifest = JSON.parse(
      readFileSync(join(repositoryRoot, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };

    const declared = manifest.dependencies?.nodemailer;
    expect(declared).toBeDefined();

    // A caret range is only safe if its floor is already patched: ^8.x would happily
    // resolve a vulnerable release.
    const floor = String(declared).replace(/^[\^~>=\s]+/, "");
    expect(atLeast(floor, "9.0.1")).toBe(true);
  });

  test("resend resolves at or above the version whose types carry topicId", () => {
    // The CSF broadcast payload sends topicId, which the SDK forwards as topic_id.
    // Below this floor the field is absent from the typed surface.
    const resolutions = [...lockfile.matchAll(/"resend@(\d+\.\d+\.\d+)"/g)].map(
      (match) => match[1],
    );

    expect(resolutions.length).toBeGreaterThan(0);
    const distinct = [...new Set(resolutions)];
    expect(distinct).toHaveLength(1);
    expect(atLeast(distinct[0], "6.10.0")).toBe(true);
  });
});
