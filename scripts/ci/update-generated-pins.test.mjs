import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  advisoryExceptionFindings,
  appendMigrationDigests,
  compareMigrationDigests,
  pinArguments,
} from "./update-generated-pins.mjs";

const repositoryRoot = join(import.meta.dir, "../..");
const digest = (character) => character.repeat(64);
const existing = `// Header comment.
export const migrationDigests = {
  "20260101000000_first.sql":
    "${digest("1")}",
  "20260102000000_second.sql":
    "${digest("2")}",
};
`;

describe("migration digest pins", () => {
  test("reports missing, drifted, and orphaned entries separately", () => {
    expect(
      compareMigrationDigests(
        { "a.sql": digest("a"), "b.sql": digest("b"), "gone.sql": digest("0") },
        { "a.sql": digest("a"), "b.sql": digest("c"), "z.sql": digest("f") },
      ),
    ).toEqual({
      missing: [{ name: "z.sql", digest: digest("f") }],
      drifted: [{ name: "b.sql", recorded: digest("b"), actual: digest("c") }],
      orphaned: ["gone.sql"],
    });
    expect(
      compareMigrationDigests(
        { "a.sql": digest("a") },
        { "a.sql": digest("a") },
      ),
    ).toEqual({ missing: [], drifted: [], orphaned: [] });
  });

  test("appends new entries and keeps every existing byte in place", () => {
    const appended = appendMigrationDigests(existing, [
      { name: "20260103000000_third.sql", digest: digest("3") },
      { name: "20260104000000_fourth.sql", digest: digest("4") },
    ]);
    expect(appended.startsWith(existing.slice(0, -"};\n".length))).toBe(true);
    expect(appended).toBe(
      `${existing.slice(0, -"};\n".length)}  "20260103000000_third.sql":
    "${digest("3")}",
  "20260104000000_fourth.sql":
    "${digest("4")}",
};
`,
    );
    expect(appendMigrationDigests(existing, [])).toBe(existing);
  });

  test("an entry older than the last one is still appended, never inserted", () => {
    const appended = appendMigrationDigests(existing, [
      { name: "20250101000000_backdated.sql", digest: digest("9") },
    ]);
    expect(appended.indexOf("20250101000000_backdated.sql")).toBeGreaterThan(
      appended.indexOf("20260102000000_second.sql"),
    );
    expect(appended.startsWith(existing.slice(0, -"};\n".length))).toBe(true);
  });

  test("refuses to rewrite, duplicate, or guess at the file's shape", () => {
    expect(() =>
      appendMigrationDigests(existing, [
        { name: "20260102000000_second.sql", digest: digest("5") },
      ]),
    ).toThrow("already names");
    expect(() =>
      appendMigrationDigests(existing, [
        { name: "20260103000000_third.sql", digest: "short" },
      ]),
    ).toThrow("invalid digest entry");
    expect(() =>
      appendMigrationDigests(existing, [
        { name: '"; process.exit(); //.sql', digest: digest("3") },
      ]),
    ).toThrow("invalid digest entry");
    for (const reshaped of [
      `${existing}export const other = {\n};\n`,
      existing.replace("};\n", "} as const;\n"),
      existing.replace(`"${digest("2")}",\n`, `"${digest("2")}"\n`),
    ]) {
      expect(() =>
        appendMigrationDigests(reshaped, [
          { name: "20260103000000_third.sql", digest: digest("3") },
        ]),
      ).toThrow("append by hand");
    }
  });

  test("the committed digest file has the shape the appender expects", async () => {
    const source = readFileSync(
      join(repositoryRoot, "scripts/production/migration-digests.mjs"),
      "utf8",
    );
    const appended = appendMigrationDigests(source, [
      { name: "20991231235959_probe.sql", digest: digest("e") },
    ]);
    expect(appended.startsWith(source.slice(0, -"};\n".length))).toBe(true);
    expect(appended.length - source.length).toBe(
      `  "20991231235959_probe.sql":\n    "${digest("e")}",\n`.length,
    );
  });
});

describe("review pins are reported, never written", () => {
  const policy = {
    expiresAt: "2026-10-21T00:00:00.000Z",
    sourceHashes: { "kept.mjs": digest("a"), "changed.mjs": digest("b") },
    graphHashes: { ".": digest("c"), "packages/sdk": digest("d") },
  };
  const hashes = {
    "kept.mjs": digest("a"),
    "changed.mjs": digest("e"),
    "bun.lock": digest("c"),
  };
  const hashOf = (path) => {
    if (!Object.hasOwn(hashes, path)) throw new Error("missing");
    return hashes[path];
  };

  test("names each stale hash with its recorded and expected value", () => {
    const { findings, expired, daysLeft } = advisoryExceptionFindings(
      policy,
      hashOf,
      new Date("2026-10-09T00:00:00.000Z"),
    );
    expect(findings).toEqual([
      {
        entry: 'sourceHashes["changed.mjs"]',
        pinned: digest("b"),
        current: digest("e"),
      },
      {
        entry: 'graphHashes["packages/sdk"]',
        pinned: digest("d"),
        current: "(file is missing)",
      },
    ]);
    expect(expired).toBe(false);
    expect(daysLeft).toBe(12);
  });

  test("an expired acceptance is stale even when every hash matches", () => {
    for (const now of [
      "2026-10-21T00:00:00.000Z",
      "2027-01-01T00:00:00.000Z",
    ]) {
      expect(
        advisoryExceptionFindings(policy, hashOf, new Date(now)).expired,
      ).toBe(true);
    }
    expect(
      advisoryExceptionFindings(policy, hashOf, new Date("invalid")).expired,
    ).toBe(true);
  });

  test("the command has no code path that writes a review pin", () => {
    const source = readFileSync(
      join(import.meta.dir, "update-generated-pins.mjs"),
      "utf8",
    );
    // Exactly one write, and it targets the append-only digest list.
    expect(source.split("writeFileSync(").length - 1).toBe(1);
    const write = source.slice(source.indexOf("writeFileSync("));
    expect(write.slice(0, write.indexOf(");"))).toContain(
      "appendMigrationDigests(readFileSync(path",
    );
    expect(source).toContain("const path = join(root, DIGESTS_PATH);");
    for (const reviewed of [
      "braces-exception.mjs",
      "app-release-catalog.mjs",
      "source-maintainability-baseline.json",
    ]) {
      expect(source).toContain(reviewed);
    }
    expect(source).not.toMatch(/appendFileSync|renameSync|rmSync|unlinkSync/u);
  });

  test("accepts check or write, never both or anything else", () => {
    expect(pinArguments([])).toEqual({ write: false });
    expect(pinArguments(["--check"])).toEqual({ write: false });
    expect(pinArguments(["--write"])).toEqual({ write: true });
    for (const args of [["--check", "--write"], ["--force"], ["write"]]) {
      expect(() => pinArguments(args)).toThrow("Usage:");
    }
  });
});
