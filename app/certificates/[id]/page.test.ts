import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const migrations = new URL("../../../supabase/migrations/", import.meta.url);
const migration = readdirSync(migrations)
  .sort()
  .reverse()
  .filter((name) => name.endsWith(".sql"))
  .map((name) => readFileSync(new URL(name, migrations), "utf8"))
  .find((source) =>
    /CREATE (?:OR REPLACE )?VIEW public\.certificate_verification_read_model/.test(
      source,
    ),
  );

describe("public certificate projection", () => {
  test("every selected field exists in the public verification view", () => {
    const view = migration!
      .split(
        /CREATE (?:OR REPLACE )?VIEW public\.certificate_verification_read_model/,
      )[1]
      .split("FROM public.certificates")[0];
    const columns = new Set(
      [...view.matchAll(/(?:c\.([a-z_]+)|AS ([a-z_]+))/g)].map(
        (match) => match[1] || match[2],
      ),
    );
    const selections = [...page.matchAll(/\.select\(\s*(["`])([\s\S]*?)\1/g)];
    expect(selections.length).toBe(2);
    for (const [, , selection] of selections) {
      for (const column of selection.split(",").map((value) => value.trim())) {
        expect(columns.has(column)).toBe(true);
      }
    }
    expect(columns.has("volunteer_email")).toBe(false);
  });

  test("print data omits private email and missing records return not found", () => {
    const selection = [
      ...page.matchAll(/\.select\(\s*(["`])([\s\S]*?)\1/g),
    ][1][2];
    for (const field of [
      "volunteer_email",
      "user_id",
      "signup_id",
      "schedule_id",
      "access_token",
    ]) {
      expect(selection).not.toContain(field);
    }
    // Absent and hidden records are a 404. A failed read is a separate branch
    // that renders before it and never reaches the record or its fields.
    expect(page).toMatch(/if \(error \|\| !record\) \{\s*notFound\(\)/);
    expect(page).toContain(
      'const ABSENT_RECORD_ERROR_CODES = new Set(["42501", "22P02"]);',
    );
    const failedRead = page.slice(
      page.indexOf("if (error && !ABSENT_RECORD_ERROR_CODES.has(error.code))"),
      page.indexOf("if (error || !record)"),
    );
    expect(failedRead).toContain("<ReadLoadError");
    expect(failedRead).not.toMatch(/\brecord\.|recordId|\bdata\.|\.message/);
    expect(page.match(/\.maybeSingle\(\)/g)).toHaveLength(1);
  });
});
