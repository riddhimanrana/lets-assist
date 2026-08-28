import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "../../..");
const migrationDirectory = join(repositoryRoot, "supabase/migrations");
const schemaMigration = readdirSync(migrationDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .reverse()
  .map((file) => ({
    file,
    sql: readFileSync(join(migrationDirectory, file), "utf8"),
  }))
  .find(({ sql }) =>
    sql.includes(
      "CREATE OR REPLACE FUNCTION plugin_data.csf_normalized_record_schema(",
    ),
  );
const pgTap = readFileSync(
  join(
    repositoryRoot,
    "supabase/tests/database/csf_class_history_source_student_key.test.sql",
  ),
  "utf8",
);

describe("CSF class-history source-key schema parity", () => {
  test("the latest SQL schema accepts the source key only for class history", () => {
    expect(schemaMigration).toBeDefined();
    const sql = schemaMigration?.sql ?? "";
    const classHistory = sql.match(
      /WHEN 'class_history' THEN '([\s\S]*?)'::jsonb/,
    )?.[1];
    const application = sql.match(
      /WHEN 'application_responses' THEN '([\s\S]*?)'::jsonb/,
    )?.[1];
    const roster = sql.match(
      /WHEN 'student_roster' THEN '([\s\S]*?)'::jsonb/,
    )?.[1];

    expect(classHistory, schemaMigration?.file).toContain(
      '"sourceStudentKey": "string"',
    );
    expect(application, schemaMigration?.file).not.toContain(
      '"sourceStudentKey"',
    );
    expect(roster, schemaMigration?.file).not.toContain('"sourceStudentKey"');
  });

  test("the replacement remains owner-internal", () => {
    const normalizedSql = (schemaMigration?.sql ?? "").replace(/\s+/g, " ");
    expect(normalizedSql).toContain(
      "REVOKE ALL ON FUNCTION plugin_data.csf_normalized_record_schema(text) FROM PUBLIC, anon, authenticated, service_role",
    );
    expect(normalizedSql).toContain(
      "GRANT EXECUTE ON FUNCTION plugin_data.csf_normalized_record_schema(text) TO postgres",
    );
  });

  test("the database contract pins the closed schema and ACL", () => {
    const declared = Number(/extensions\.plan\((\d+)\)/u.exec(pgTap)?.[1]);
    const actual = [
      ...pgTap.matchAll(/SELECT\s+extensions\.(?!plan\b|finish\b)\w+\s*\(/giu),
    ].length;

    expect({ actual, declared }).toEqual({ actual: 8, declared: 8 });
    expect(pgTap).toContain(
      "class history accepts the bounded roster source key",
    );
    expect(pgTap).toContain("application responses cannot acquire");
    expect(pgTap).toContain("student-roster imports keep their existing");
  });
});
