import { describe, expect, test } from "bun:test";

import {
  checkSupabaseSeedSafety,
  isTrackedSeedSql,
  RULES,
  scanSeedScript,
  scanSeedSql,
  stripSqlComments,
  validateSeedConfig,
} from "./check-supabase-seed-safety.mjs";

const safeConfig = `[db.seed]
enabled = true
sql_paths = ["./seeds/local-only.sql"]

[studio]
enabled = true
`;

describe("Supabase seed safety guard", () => {
  test("allows a comment-only canonical seed and fictional local fixture values", () => {
    expect(stripSqlComments("-- empty\n/* still empty */\n\t").trim()).toBe("");
    expect(
      scanSeedSql("supabase/seed.sql", "-- intentionally empty\n"),
    ).toEqual([]);
    expect(
      scanSeedSql(
        "supabase/seeds/local-only.sql",
        "insert into demo(email) values ('member@local.test'), ('member@example.org');",
      ),
    ).toEqual([]);
  });

  test("rejects executable canonical seed SQL and alternate reset seed paths", () => {
    expect(
      scanSeedSql("supabase/seed.sql", "-- looks empty\nselect 1;").map(
        (finding: { rule: string }) => finding.rule,
      ),
    ).toContain(RULES.EXECUTABLE_CANONICAL_SEED);
    expect(
      scanSeedSql("supabase/seeds/remote-snapshot.sql", "select 1;").map(
        (finding: { rule: string }) => finding.rule,
      ),
    ).toContain(RULES.UNEXPECTED_SEED_PATH);
  });

  test("detects real-looking email, phone, OAuth, invitation, and hosted Supabase values", () => {
    // Construct detector-shaped values at runtime so repository secret scanners
    // do not mistake these deliberately fake negative fixtures for credentials.
    const googleAccessToken = ["ya29", "ABCDEFGHIJKLMNOP"].join(".");
    const googleRefreshToken = ["1", "//", "ABCDEFGHIJKLMNOP"].join("");
    const bearerValue = ["Bear", "er", "abcdefghijklmnopqrstuvwxyz"].join(
      " ",
    ).replace("Bear er", "Bearer");
    const source = `
      access_token = '${googleAccessToken}';
      refresh_token = '${googleRefreshToken}';
      authorization = '${bearerValue}';
      contact_email = 'student@gmail.com';
      phone = '+1 (925) 555-0199';
      join_code = 'SPRING26';
      source_url = 'https://real-project-ref.supabase.co';
    `;
    const rules = scanSeedSql("supabase/seeds/local-only.sql", source).map(
      (finding: { rule: string }) => finding.rule,
    );
    expect(rules).toContain(RULES.EMAIL);
    expect(rules).toContain(RULES.PHONE);
    expect(rules).toContain(RULES.OAUTH_TOKEN);
    expect(rules).toContain(RULES.REUSABLE_INVITATION);
    expect(rules).toContain(RULES.PRODUCTION_SUPABASE_URL);
  });

  test("scans JavaScript fixture generators for contactable identities and hosted backends", () => {
    const rules = scanSeedScript(
      "scripts/local-dev/seed-platform.mjs",
      `const fixture = { email: "student@gmail.com", url: "https://real-project-ref.supabase.co" };`,
    ).map((finding: { rule: string }) => finding.rule);
    expect(rules).toContain(RULES.EMAIL);
    expect(rules).toContain(RULES.PRODUCTION_SUPABASE_URL);
  });

  test("does not treat schema names or runtime-generated invitation values as secrets", () => {
    const source = `
      create table demo(join_code text, refresh_token text);
      insert into demo(join_code) values (encode(gen_random_bytes(16), 'hex'));
      insert into demo(email, url) values ('admin@local.test', 'https://example.supabase.co');
    `;
    expect(scanSeedSql("supabase/migrations/seed_demo.sql", source)).toEqual(
      [],
    );
  });

  test("detects fixed token material mapped through INSERT column order", () => {
    const source = `
      insert into auth_cache(id, access_token, join_code)
      values
        ('fixture-one', 'opaque-access-secret', 'AUTUMN26'),
        ('fixture-two', 'second-access-secret', 'SPRING27');
    `;
    const rules = scanSeedSql(
      "supabase/seeds/local-only.sql",
      source,
    ).map((finding: { rule: string }) => finding.rule);
    expect(
      rules.filter((rule: string) => rule === RULES.OAUTH_TOKEN),
    ).toHaveLength(2);
    expect(
      rules.filter(
        (rule: string) => rule === RULES.REUSABLE_INVITATION,
      ),
    ).toHaveLength(2);
  });

  test("requires exactly the canonical configured SQL seed path", () => {
    expect(validateSeedConfig(safeConfig)).toEqual([]);
    expect(
      validateSeedConfig(
        `[db.seed]\nsql_paths = ["./seed.sql", "./seeds/local-only.sql"]`,
      )[0]?.rule,
    ).toBe(RULES.INVALID_SEED_CONFIG);
  });

  test("discovers seed SQL deterministically without scanning unrelated migrations", () => {
    expect(isTrackedSeedSql("supabase/seed.sql")).toBe(true);
    expect(isTrackedSeedSql("supabase/seeds/local-only.sql")).toBe(true);
    expect(
      isTrackedSeedSql("supabase/snippets/seed_dummy_orgs.sql"),
    ).toBe(true);
    expect(
      isTrackedSeedSql("supabase/migrations/20260101000000_profiles.sql"),
    ).toBe(false);
  });

  test("returns stable file, line, and rule ordering across tracked files", () => {
    const sources: Record<string, string> = {
      "supabase/config.toml": safeConfig,
      "supabase/seed.sql": "-- empty\n",
      "supabase/seeds/local-only.sql":
        "insert into demo(email) values ('person@gmail.com');\nphone = '925-555-0199';",
    };
    const findings = checkSupabaseSeedSafety({
      files: Object.keys(sources).reverse(),
      readFile: (file) => sources[file],
    });
    expect(
      findings.map((finding: { rule: string }) => finding.rule),
    ).toEqual([
      RULES.EMAIL,
      RULES.PHONE,
    ]);
    expect(
      findings.map((finding: { line: number }) => finding.line),
    ).toEqual([1, 2]);
  });
});
