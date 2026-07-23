import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assertSupabaseMigrationParity,
  findSupabaseMigrationMismatches,
  readTrackedMigrationVersions,
} from "./verify-supabase-migration-parity.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Supabase migration parity", () => {
  test("accepts the pinned CLI JSON when every local migration is remote", () => {
    const payload = {
      migrations: [
        {
          local: "20260721071359",
          remote: "20260721071359",
          time: "2026-07-21 07:13:59",
        },
      ],
    };

    expect(findSupabaseMigrationMismatches(payload)).toEqual([]);
    expect(() =>
      assertSupabaseMigrationParity(payload, ["20260721071359"]),
    ).not.toThrow();
  });

  test("rejects missing, malformed, and different remote versions", () => {
    const payload = {
      migrations: [
        { local: "20260721071359", remote: "" },
        { local: "`20260721071854`", remote: "20260721071854" },
        { local: "20260721095945", remote: "20260721095946" },
      ],
    };

    expect(findSupabaseMigrationMismatches(payload)).toHaveLength(3);
    expect(() =>
      assertSupabaseMigrationParity(payload, [
        "20260721071359",
        "20260721071854",
        "20260721095945",
      ]),
    ).toThrow("3 Supabase migration-history mismatch(es)");
  });

  test("fails closed when the CLI response shape changes", () => {
    expect(() => findSupabaseMigrationMismatches({ rows: [] })).toThrow(
      "does not contain a migrations array",
    );
  });

  test("rejects empty CLI output instead of reporting false parity", () => {
    expect(() =>
      assertSupabaseMigrationParity({ migrations: [] }, ["20260721071359"]),
    ).toThrow("migration output is empty");
  });

  test("rejects local or remote sets that differ from tracked filenames", () => {
    const payload = {
      migrations: [
        { local: "20260721071359", remote: "20260721071359" },
      ],
    };

    expect(() =>
      assertSupabaseMigrationParity(payload, [
        "20260721071359",
        "20260721071854",
      ]),
    ).toThrow("CLI local migration set does not match tracked files");
  });

  test("rejects duplicate timestamps in the tracked migration set", () => {
    const payload = {
      migrations: [
        { local: "20260721071359", remote: "20260721071359" },
      ],
    };

    expect(() =>
      assertSupabaseMigrationParity(payload, [
        "20260721071359",
        "20260721071359",
      ]),
    ).toThrow("duplicate timestamp");
  });

  test("derives the expected set from strictly named tracked files", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "supabase-migrations-"));
    temporaryDirectories.push(directory);
    await writeFile(path.join(directory, "20260721071359_first.sql"), "-- first\n");
    await writeFile(path.join(directory, "20260721071854_second.sql"), "-- second\n");

    expect(readTrackedMigrationVersions(directory)).toEqual([
      "20260721071359",
      "20260721071854",
    ]);
  });

  test("rejects an empty or malformed tracked migration directory", async () => {
    const emptyDirectory = await mkdtemp(
      path.join(tmpdir(), "supabase-migrations-empty-"),
    );
    temporaryDirectories.push(emptyDirectory);
    expect(() => readTrackedMigrationVersions(emptyDirectory)).toThrow(
      "No tracked Supabase migration files",
    );

    await writeFile(path.join(emptyDirectory, "migration.sql"), "-- bad\n");
    expect(() => readTrackedMigrationVersions(emptyDirectory)).toThrow(
      "Invalid tracked Supabase migration filename",
    );
  });
});
