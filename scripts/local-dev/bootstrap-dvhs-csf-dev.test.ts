import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realpathSync } from "node:fs";

import {
  assertMigrationVersionParity,
  candidateWorkDirectories,
  ensureFixturePassword,
  findReusableWorkDirectories,
  selectReusableWorkDirectory,
} from "./bootstrap-dvhs-csf-dev.mjs";

const temporaryDirectories: string[] = [];

function scratch(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("one-command CSF local bootstrap", () => {
  test("discovers only generated CSF directories and reuses only validated running stacks", () => {
    const root = scratch("csf-bootstrap-discovery-");
    const valid = join(root, "lets-assist-csf-browser-valid");
    const stopped = join(root, "lets-assist-csf-browser-stopped");
    const unrelated = join(root, "other-project");
    for (const directory of [valid, stopped, unrelated]) mkdirSync(directory);

    const candidates = candidateWorkDirectories(root);
    expect(candidates).toEqual([stopped, valid].sort());
    const reusable = findReusableWorkDirectories(candidates, (candidate) => {
      if (candidate === stopped) throw new Error("stopped");
      return candidate;
    });
    expect(reusable).toEqual([realpathSync(valid)]);
    expect(selectReusableWorkDirectory(reusable)).toBe(realpathSync(valid));
  });

  test("refuses ambiguity instead of choosing between two running databases", () => {
    expect(() => selectReusableWorkDirectory(["/tmp/a", "/tmp/b"])).toThrow(
      "Found 2 running isolated CSF stacks",
    );
  });

  test("reuses a stack only when copied and applied migrations match the repository", () => {
    const current = ["20260101000000", "20260102000000"];
    expect(() =>
      assertMigrationVersionParity({
        repositoryVersions: current,
        isolatedVersions: [...current].reverse(),
        appliedVersions: current,
      }),
    ).not.toThrow();
    expect(() =>
      assertMigrationVersionParity({
        repositoryVersions: current,
        isolatedVersions: [current[0]],
        appliedVersions: [current[0]],
      }),
    ).toThrow("does not match the current repository migration tree");
  });

  test("reports rejected candidates without making them reusable", () => {
    const root = scratch("csf-bootstrap-rejections-");
    const stale = join(root, "stale");
    const current = join(root, "current");
    mkdirSync(stale);
    mkdirSync(current);
    const rejected: string[] = [];
    const reusable = findReusableWorkDirectories(
      [stale, current],
      (candidate) => {
        if (candidate.endsWith("stale")) throw new Error("stale migrations");
        return candidate;
      },
      (candidate) => rejected.push(candidate),
    );
    expect(reusable).toEqual([realpathSync(current)]);
    expect(rejected).toEqual([stale]);
  });

  test("creates one owner-only password and preserves it across runs", () => {
    const workDir = scratch("csf-bootstrap-password-");
    const first = ensureFixturePassword(workDir);
    const second = ensureFixturePassword(workDir);
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(16);
  });

  test("refuses a hard-linked fixture password", () => {
    const workDir = scratch("csf-bootstrap-password-link-");
    const target = join(workDir, "csf-local-test-password");
    writeFileSync(target, "synthetic-password-Aa1!\n", { mode: 0o600 });
    chmodSync(target, 0o600);
    linkSync(target, join(workDir, "second-name"));
    expect(() => ensureFixturePassword(workDir)).toThrow("exactly one hard link");
  });
});
