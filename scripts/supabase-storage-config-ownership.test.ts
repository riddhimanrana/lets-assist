import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");
const supabaseConfig = readFileSync(
  join(repositoryRoot, "supabase/config.toml"),
  "utf8",
);
const migrationLedger = readdirSync(join(repositoryRoot, "supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .map((name) =>
    readFileSync(join(repositoryRoot, "supabase/migrations", name), "utf8"),
  )
  .join("\n");

describe("Supabase Storage configuration ownership", () => {
  test("keeps bucket metadata in the migration ledger instead of branch config", () => {
    expect(supabaseConfig).toContain("[storage]");
    expect(supabaseConfig).not.toMatch(/^\[storage\.buckets(?:\.|\])/mu);
    expect(migrationLedger).toContain("INSERT INTO storage.buckets");
  });
});
