import { describe, expect, test } from "bun:test";
import {
  affectedArguments,
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

  test("passes one shard of the same scope to the orchestrator", () => {
    const base = "b".repeat(40);
    for (const [changed, scope] of [
      ["services/email.ts", ["--application-only"]],
      ["scripts/example.mjs", []],
    ]) {
      const spawned = [];
      for (const index of [1, 2]) {
        runAffectedUnitTests(base, {
          shard: { index, total: 2 },
          exec: () => `${changed}\0`,
          spawn(command, args) {
            spawned.push(args);
            return { status: 0 };
          },
          log: () => {},
        });
      }
      // Every shard carries the same scope, so together they cover it.
      expect(spawned).toEqual([
        ["scripts/run-tests.mjs", ...scope, "--shard=1/2"],
        ["scripts/run-tests.mjs", ...scope, "--shard=2/2"],
      ]);
    }
    expect(unitTestArguments(["app/page.tsx"])).toEqual([
      "scripts/run-tests.mjs",
      "--application-only",
    ]);
  });

  test("a documentation-only diff runs nothing in any shard", () => {
    let spawned = false;
    const lines = [];
    runAffectedUnitTests("c".repeat(40), {
      shard: { index: 2, total: 2 },
      exec: () => "docs/development/testing.md\0",
      spawn() {
        spawned = true;
        return { status: 0 };
      },
      log: (line) => lines.push(line),
    });
    expect(spawned).toBe(false);
    expect(lines.join("\n")).toContain("No runtime, test, configuration");
  });

  test("parses the base and an optional shard, and rejects anything else", () => {
    const base = "d".repeat(40);
    expect(affectedArguments([base])).toEqual({ baseSha: base, shard: null });
    expect(affectedArguments([base, "--shard=2/2"])).toEqual({
      baseSha: base,
      shard: { index: 2, total: 2 },
    });
    expect(affectedArguments(["--shard=1/2", base])).toEqual({
      baseSha: base,
      shard: { index: 1, total: 2 },
    });
    for (const args of [
      [],
      [base, base],
      [base, "--application-only"],
      ["--shard=1/2"],
    ]) {
      expect(() => affectedArguments(args), args.join(" ")).toThrow("Usage:");
    }
    for (const args of [
      [base, "--shard=0/2"],
      [base, "--shard=3/2"],
      [base, "--shard"],
      [base, "--shard=1/2", "--shard=2/2"],
    ]) {
      expect(() => affectedArguments(args), args.join(" ")).toThrow(
        "Invalid shard",
      );
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
