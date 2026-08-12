import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migration = readFileSync(
  join(
    root,
    "supabase/migrations/20260812162732_recheck_csf_activity_partner_authorization_under_lock.sql",
  ),
  "utf8",
);
const concurrencyTest = readFileSync(
  join(
    root,
    "supabase/tests/database/csf_activity_partner_authorization_recheck.test.sql",
  ),
  "utf8",
);

const operations = [
  {
    name: "csf_create_activity",
    signature: "uuid, uuid, uuid, jsonb, uuid, uuid",
    permission: "manage_opportunities",
    error: "Not authorized to manage CSF activities.",
  },
  {
    name: "csf_update_activity",
    signature: "uuid, uuid, uuid, uuid, jsonb, uuid, uuid",
    permission: "manage_opportunities",
    error: "Not authorized to manage CSF activities.",
  },
  {
    name: "csf_set_activity_status",
    signature: "uuid, uuid, text, text, uuid, uuid",
    permission: "manage_opportunities",
    error: "Not authorized to manage CSF activities.",
  },
  {
    name: "csf_link_activity_project",
    signature: "uuid, uuid, uuid, uuid, uuid",
    permission: "manage_opportunities",
    error: "Not authorized to manage CSF activities.",
  },
  {
    name: "csf_set_partner_club_status",
    signature: "uuid, uuid, text, uuid, uuid",
    permission: "manage_partner_clubs",
    error: "Not authorized to manage CSF partner clubs.",
  },
] as const;

function functionBody(name: string): string {
  const start = migration.indexOf(`CREATE FUNCTION plugin_data.${name}(`);
  const next = migration.indexOf("CREATE FUNCTION plugin_data.", start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  return migration.slice(start, next < 0 ? migration.length : next);
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("CSF activity and partner mutation authorization lock boundary", () => {
  for (const operation of operations) {
    test(`${operation.name} locks mutable authorization before request or business state`, () => {
      const body = functionBody(operation.name);
      const firstAuthorization = body.indexOf(
        "plugin_data.csf_actor_has_permission(",
      );
      const staffLock = body.indexOf("plugin_data.csf_staff_access_lock_key(");
      const membershipRead = body.indexOf(
        "FROM public.organization_members AS member",
      );
      const membershipLock = body.indexOf("FOR SHARE", membershipRead);
      const secondAuthorization = body.indexOf(
        "plugin_data.csf_actor_has_permission(",
        firstAuthorization + 1,
      );
      const implementation = body.indexOf(`${operation.name}_locked_impl(`);

      expect(firstAuthorization).toBeGreaterThanOrEqual(0);
      expect(body.slice(firstAuthorization, staffLock)).toContain(
        `'${operation.permission}'`,
      );
      expect(firstAuthorization).toBeLessThan(staffLock);
      expect(staffLock).toBeLessThan(membershipRead);
      expect(membershipRead).toBeLessThan(membershipLock);
      expect(membershipLock).toBeLessThan(secondAuthorization);
      expect(body.slice(secondAuthorization, implementation)).toContain(
        `'${operation.permission}'`,
      );
      expect(secondAuthorization).toBeLessThan(implementation);
      expect(body).toContain(`RAISE EXCEPTION '${operation.error}'`);
      expect(body).toContain("member.status = 'active'");
      expect(body).toContain("SECURITY DEFINER");
      expect(body).toContain("SET search_path = ''");
    });
  }

  test("every prior transaction is renamed behind an owner-only implementation", () => {
    for (const operation of operations) {
      expect(migration).toMatch(
        new RegExp(
          `ALTER FUNCTION plugin_data\\.${escaped(operation.name)}\\([\\s\\S]*?\\)\\s*RENAME TO ${escaped(operation.name)}_locked_impl;`,
        ),
      );
      expect(migration).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION plugin_data\\.${escaped(operation.name)}_locked_impl\\([\\s\\S]*?FROM PUBLIC, anon, authenticated, service_role;`,
        ),
      );
      expect(migration).not.toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION plugin_data\\.${escaped(operation.name)}_locked_impl`,
        ),
      );
      expect(migration).toMatch(
        new RegExp(
          `COMMENT ON FUNCTION\\s+plugin_data\\.${escaped(operation.name)}_locked_impl\\([\\s\\S]*?Owner-only`,
        ),
      );
    }
  });

  test("only the unchanged stable signatures are explicitly service-callable", () => {
    for (const operation of operations) {
      const signature = escaped(operation.signature).replaceAll("\\ ", "\\s*");
      expect(migration).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION plugin_data\\.${escaped(operation.name)}\\(\\s*${signature}\\s*\\)[\\s\\S]*?FROM PUBLIC, anon, authenticated, service_role;`,
        ),
      );
      expect(migration).toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION plugin_data\\.${escaped(operation.name)}\\(\\s*${signature}\\s*\\)[\\s\\S]*?TO service_role;`,
        ),
      );
      expect(migration).toMatch(
        new RegExp(
          `COMMENT ON FUNCTION\\s+plugin_data\\.${escaped(operation.name)}\\([\\s\\S]*?Server-only`,
        ),
      );
    }
  });

  test("the autocommit pgTAP suite exercises every stale-authorization path", () => {
    expect(concurrencyTest).not.toContain("ROLLBACK;");
    expect(concurrencyTest).toContain("dblink_send_query");
    expect(concurrencyTest).toContain("pg_stat_activity");
    expect(concurrencyTest).toContain("csf_update_role(");
    expect(concurrencyTest).toContain("csf_revoke_staff_position(");

    for (const operation of operations) {
      expect(concurrencyTest).toContain(
        `SELECT plugin_data.${operation.name}(`,
      );
    }

    for (const requestId of [
      "f9a00000-0000-4000-8000-000000000001",
      "f9a00000-0000-4000-8000-000000000002",
      "f9a00000-0000-4000-8000-000000000003",
      "f9a00000-0000-4000-8000-000000000004",
      "f9a00000-0000-4000-8000-000000000005",
    ]) {
      expect(concurrencyTest).toContain(requestId);
      expect(concurrencyTest).toMatch(
        new RegExp(
          `correlation_id = '${escaped(requestId)}'[\\s\\S]{0,120}?\\),\\s*0,`,
        ),
      );
    }

    expect(concurrencyTest).toContain(
      "an exact committed replay is denied after the actor loses permission",
    );
    expect(concurrencyTest).toContain(
      "the active admin receives the unchanged non-idempotent result contract from all five RPCs",
    );
    expect(concurrencyTest).toContain(
      "a cross-organization wrapper completes while the first organization lock is held",
    );
  });
});
