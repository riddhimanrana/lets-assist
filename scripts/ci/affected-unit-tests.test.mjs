import { describe, expect, test } from "bun:test";
import {
  requiresUnitTests,
  runAffectedUnitTests,
  unitTestArguments,
} from "./run-affected-unit-tests.mjs";

describe("pull request unit coverage", () => {
  test("skips only plain documentation diffs", () => {
    expect(
      requiresUnitTests(["docs/development/testing.md", "README.md"]),
    ).toBe(false);
    for (const file of [
      "app/page.tsx",
      "lib/plugins/private",
      "bun.lock",
      "scripts/probe.sql",
      ".github/workflows/ci.yml",
      "docs/csf/example.json",
      "AGENTS.md",
      "public/demo.svg",
    ]) {
      expect(requiresUnitTests([file])).toBe(true);
    }
  });
  test("compares exact base to the tested merge checkout without shell interpolation", () => {
    const base = "a".repeat(40);
    let spawned = false;
    runAffectedUnitTests(base, {
      exec(command, args) {
        expect(command).toBe("git");
        expect(args).toEqual([
          "diff",
          "--name-only",
          "--no-renames",
          "-z",
          base,
          "HEAD",
          "--",
        ]);
        return "services/email.ts\0";
      },
      spawn(command, args) {
        expect(command).toBe(process.execPath);
        expect(args).toEqual(["scripts/run-tests.mjs", "--application-only"]);
        spawned = true;
        return { status: 0 };
      },
      log: () => {},
    });
    expect(spawned).toBe(true);
  });
  test("tooling, lockfiles and private gitlinks retain all unit groups", () => {
    for (const file of [
      "scripts/example.mjs",
      "bun.lock",
      "lib/plugins/private",
      ".github/workflows/ci.yml",
    ]) {
      expect(unitTestArguments([file])).toEqual(["scripts/run-tests.mjs"]);
    }
  });

  test("rejects missing or injected refs and propagates unit failures", () => {
    expect(() => runAffectedUnitTests("main;echo unexpected")).toThrow(
      "exact 40-character",
    );
    expect(() =>
      runAffectedUnitTests("a".repeat(40), {
        exec: () => "package.json\0",
        spawn: () => ({ status: 1 }),
        log: () => {},
      }),
    ).toThrow("Affected unit tests failed");
  });
});
