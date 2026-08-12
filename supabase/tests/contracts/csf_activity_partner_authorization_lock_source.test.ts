import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "../../..");
const read = (path: string) => readFileSync(join(repositoryRoot, path), "utf8");

const migration = read(
  "supabase/migrations/20260812225436_recheck_csf_activity_partner_authorization_under_lock.sql",
);
const concurrencyTest = read(
  "supabase/tests/database/csf_activity_partner_authorization_recheck.test.sql",
);
const opportunityActions = read(
  "lib/plugins/private/plugins/dvhs-csf/server/actions/opportunities.ts",
);
const partnerClubActions = read(
  "lib/plugins/private/plugins/dvhs-csf/server/actions/partner-clubs.ts",
);

const ACTIVITY_DENIAL = "Not authorized to manage CSF activities.";
const PARTNER_DENIAL = "Not authorized to manage CSF partner clubs.";

const operations = [
  {
    name: "csf_create_activity",
    signature: "uuid, uuid, uuid, jsonb, uuid, uuid",
    permission: "manage_opportunities",
    error: ACTIVITY_DENIAL,
    caller: opportunityActions,
  },
  {
    name: "csf_update_activity",
    signature: "uuid, uuid, uuid, uuid, jsonb, uuid, uuid",
    permission: "manage_opportunities",
    error: ACTIVITY_DENIAL,
    caller: opportunityActions,
  },
  {
    name: "csf_set_activity_status",
    signature: "uuid, uuid, text, text, uuid, uuid",
    permission: "manage_opportunities",
    error: ACTIVITY_DENIAL,
    caller: opportunityActions,
  },
  {
    name: "csf_link_activity_project",
    signature: "uuid, uuid, uuid, uuid, uuid",
    permission: "manage_opportunities",
    error: ACTIVITY_DENIAL,
    caller: opportunityActions,
  },
  {
    name: "csf_set_partner_club_status",
    signature: "uuid, uuid, text, uuid, uuid",
    permission: "manage_partner_clubs",
    error: PARTNER_DENIAL,
    caller: partnerClubActions,
  },
  {
    name: "csf_set_partner_club_term_status",
    signature: "uuid, uuid, text, text, uuid, uuid",
    permission: "manage_partner_clubs",
    error: PARTNER_DENIAL,
    caller: partnerClubActions,
  },
  {
    name: "csf_upsert_partner_club_policy",
    signature: "uuid, uuid, uuid, jsonb",
    permission: "manage_partner_clubs",
    error: PARTNER_DENIAL,
    caller: partnerClubActions,
  },
] as const;

// The stable named arguments the private Server Actions pass positionally by
// name through PostgREST. A rename here is a silent production break.
const argumentNames: Record<string, readonly string[]> = {
  csf_create_activity: [
    "p_organization_id",
    "p_term_id",
    "p_cohort_id",
    "p_activity",
    "p_actor_user_id",
    "p_request_id",
  ],
  csf_update_activity: [
    "p_organization_id",
    "p_activity_id",
    "p_term_id",
    "p_cohort_id",
    "p_activity",
    "p_actor_user_id",
    "p_request_id",
  ],
  csf_set_activity_status: [
    "p_organization_id",
    "p_activity_id",
    "p_status",
    "p_reason",
    "p_actor_user_id",
    "p_request_id",
  ],
  csf_link_activity_project: [
    "p_organization_id",
    "p_activity_id",
    "p_project_id",
    "p_actor_user_id",
    "p_request_id",
  ],
  csf_set_partner_club_status: [
    "p_organization_id",
    "p_partner_club_id",
    "p_status",
    "p_actor_user_id",
    "p_request_id",
  ],
  csf_set_partner_club_term_status: [
    "p_organization_id",
    "p_partner_club_term_id",
    "p_status",
    "p_reason",
    "p_actor_user_id",
    "p_correlation_id",
  ],
  csf_upsert_partner_club_policy: [
    "p_organization_id",
    "p_actor_user_id",
    "p_request_id",
    "p_request",
  ],
};

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
  test("the consolidated migration is later than every currently open migration", () => {
    // #158 carries the latest open migration version. A stale or backdated
    // version would replay before it and silently lose this repair.
    expect("20260812225436" > "20260812215733").toBe(true);
    expect(migration).not.toContain("20260812162732");
  });

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
      const membershipGuard = body.indexOf("IF NOT FOUND", membershipLock);
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
      expect(membershipLock).toBeLessThan(membershipGuard);
      expect(membershipGuard).toBeLessThan(secondAuthorization);
      expect(body.slice(secondAuthorization, implementation)).toContain(
        `'${operation.permission}'`,
      );
      expect(secondAuthorization).toBeLessThan(implementation);
      expect(body).toContain(`RAISE EXCEPTION '${operation.error}'`);
      expect(body).toContain("member.status = 'active'");
      expect(body).toContain("SECURITY DEFINER");
      expect(body).toContain("SET search_path = ''");
    });

    test(`${operation.name} preserves its exact public argument names`, () => {
      const body = functionBody(operation.name);
      const declarationEnd = body.indexOf(")\nRETURNS jsonb");
      const declaration = body.slice(0, declarationEnd);

      expect(declarationEnd).toBeGreaterThan(0);
      expect(
        [...declaration.matchAll(/^\s+(p_[a-z_]+)\s+/gmu)].map(
          (match) => match[1],
        ),
      ).toEqual([...argumentNames[operation.name]]);
    });
  }

  test("all seven prior transactions are renamed behind owner-only implementations", () => {
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
    expect(migration).not.toContain("CREATE EVENT TRIGGER");
    expect(migration).not.toContain("GRANT EXECUTE ON ALL FUNCTIONS");
    expect(migration).not.toMatch(
      /GRANT[\s\S]{0,80}TO (anon|authenticated|PUBLIC)/u,
    );
  });

  test("the autocommit pgTAP suite exercises every stale-authority path", () => {
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

    // One queued race per function class, each with its own request id.
    for (const requestId of [
      "f9a00000-0000-4000-8000-000000000001",
      "f9a00000-0000-4000-8000-000000000002",
      "f9a00000-0000-4000-8000-000000000003",
      "f9a00000-0000-4000-8000-000000000004",
      "f9a00000-0000-4000-8000-000000000005",
      "f9a00000-0000-4000-8000-000000000006",
      "f9a00000-0000-4000-8000-000000000007",
    ]) {
      expect(concurrencyTest).toContain(requestId);
      expect(concurrencyTest).toMatch(
        new RegExp(
          `correlation_id = '${escaped(requestId)}'[\\s\\S]{0,200}?\\),?\\s*0,`,
        ),
      );
    }

    // Membership concurrency must be exercised for real, not asserted from
    // source strings.
    expect(concurrencyTest).toMatch(
      /UPDATE public\.organization_members\s+SET status = 'inactive'/u,
    );
    expect(concurrencyTest).toMatch(
      /DELETE FROM public\.organization_members/u,
    );
    expect(concurrencyTest).toContain("'55P03'");
    expect(concurrencyTest).toContain(
      "canceling statement due to lock timeout",
    );

    for (const description of [
      "the queued standing call fails after the host membership is deactivated",
      "the queued policy call fails after the host membership row is deleted",
      "a concurrent membership deactivation blocks while the wrapper holds the actor membership row",
      "a benign concurrent staff edit does not deny the still-authorized queued create",
      "the exact retry of a committed request still returns its idempotent receipt",
      "an exact committed replay is denied after the actor loses permission",
      "the active admin receives the unchanged non-idempotent result contract from all seven RPCs",
      "a cross-organization wrapper completes while the first organization lock is held",
    ]) {
      expect(concurrencyTest).toContain(description);
    }
  });

  test("every calling Server Action surfaces the database authorization denial verbatim", () => {
    // The intentional replay change means a denied call can follow a durable
    // committed outcome. No call site may replace the database's authorization
    // sentence with a generic failure string, and none may report success.
    for (const operation of operations) {
      expect(operation.caller).toContain(`plugin.rpc("${operation.name}"`);
    }

    for (const caller of [opportunityActions, partnerClubActions]) {
      // Every RPC error is thrown, so it reaches the shared catch that returns
      // `error.message`; nothing swallows it into a success result.
      expect(caller).toContain("error instanceof Error");
      expect(caller).toContain("? error.message");
      expect(caller).not.toMatch(
        /if\s*\(error\)\s*\{?\s*return\s*\{\s*success:\s*true/u,
      );
      expect(caller).not.toContain("no changes were saved");
      expect(caller).not.toContain("nothing was written");
    }

    const rpcCallSites = [
      ...opportunityActions.matchAll(/plugin\.rpc\("(csf_[a-z_]+)"/gu),
      ...partnerClubActions.matchAll(/plugin\.rpc\("(csf_[a-z_]+)"/gu),
    ].map((match) => match[1]);
    for (const operation of operations) {
      expect(rpcCallSites).toContain(operation.name);
    }
  });
});
