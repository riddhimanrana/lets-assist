import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "../../..");
const migrationsRoot = join(repositoryRoot, "supabase/migrations");

function readRepairMigration() {
  const migrationName = readdirSync(migrationsRoot).find((name) =>
    name.endsWith("_google_cap_effect_fencing.sql"),
  );
  expect(migrationName).toBeDefined();
  return readFileSync(join(migrationsRoot, migrationName ?? ""), "utf8");
}

describe("Google CAP effect fencing migration source", () => {
  test("fences the Auth effect and revalidates indexed identity ownership", () => {
    const migration = readRepairMigration();

    expect(migration).toContain("begin_google_cap_event_effect");
    expect(migration).toContain("status = 'effect_started'");
    expect(migration).toContain("claim_token = p_claim_token");
    expect(migration).toContain(
      "lease_expires_at > pg_catalog.clock_timestamp()",
    );
    expect(migration).toContain("identity_row.provider_id = p_google_subject");
    expect(migration).not.toContain("identity_data ->> 'sub'");
  });

  test("keeps effect-started work exclusive and non-reclaimable", () => {
    const migration = readRepairMigration();

    expect(migration).toContain(
      "WHERE status IN ('processing', 'effect_started')",
    );
    expect(migration).toContain("effect_started");
    expect(migration).toContain("'in_progress'::text");
  });

  test("publishes least-privilege RPC grants", () => {
    const migration = readRepairMigration();

    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.begin_google_cap_event_effect",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.begin_google_cap_event_effect",
    );
    expect(migration).toContain("TO service_role");
  });
});
