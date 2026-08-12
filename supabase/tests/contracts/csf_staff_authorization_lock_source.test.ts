import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read(
  "supabase/migrations/20260812114638_recheck_csf_staff_authorization_under_lock.sql",
);

function functionBody(name: string): string {
  const start = migration.indexOf(`CREATE FUNCTION plugin_data.${name}(`);
  const next = migration.indexOf("CREATE FUNCTION plugin_data.", start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  return migration.slice(start, next < 0 ? migration.length : next);
}

describe("CSF staff mutation authorization lock boundary", () => {
  for (const name of ["csf_revoke_staff_position", "csf_update_role"]) {
    test(`${name} checks authorization before input work and again under the lock`, () => {
      const body = functionBody(name);
      const firstAuthorization = body.indexOf(
        "plugin_data.csf_actor_can_manage_staff(",
      );
      const lock = body.indexOf("pg_advisory_xact_lock(");
      const secondAuthorization = body.indexOf(
        "plugin_data.csf_actor_can_manage_staff(",
        firstAuthorization + 1,
      );
      const implementation = body.indexOf(`${name}_locked_impl(`);

      expect(firstAuthorization).toBeGreaterThanOrEqual(0);
      expect(firstAuthorization).toBeLessThan(lock);
      expect(lock).toBeLessThan(secondAuthorization);
      expect(secondAuthorization).toBeLessThan(implementation);
      expect(body).toContain("SECURITY DEFINER");
      expect(body).toContain("SET search_path = ''");
    });
  }

  test("only the stable wrappers remain service-callable", () => {
    for (const name of [
      "csf_revoke_staff_position_locked_impl",
      "csf_update_role_locked_impl",
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION plugin_data\\.${name}\\([\\s\\S]*?FROM PUBLIC, anon, authenticated, service_role;`,
        ),
      );
      expect(migration).not.toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION plugin_data\\.${name}`),
      );
    }

    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION plugin_data\.csf_revoke_staff_position\([\s\S]*?TO service_role;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION plugin_data\.csf_update_role\([\s\S]*?TO service_role;/,
    );
  });

  test("pgTAP exercises both stale-authorization interleavings", () => {
    const pgTap = read(
      "supabase/tests/database/csf_staff_recovery_seat_floor.test.sql",
    );

    expect(pgTap).toContain("stale_staff_role_writer");
    expect(pgTap).toContain("stale_staff_revoke_writer");
    expect(pgTap).toContain(
      "the queued role edit rechecks authorization after acquiring the lock",
    );
    expect(pgTap).toContain(
      "the queued revocation rechecks authorization after acquiring the lock",
    );
    expect(pgTap).toContain("the stale staff actor changes no role data");
    expect(pgTap).toContain(
      "the refused stale revocation writes no position history",
    );
  });
});
