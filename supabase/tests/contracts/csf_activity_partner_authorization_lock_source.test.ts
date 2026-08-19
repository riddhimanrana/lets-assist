import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "../../..");
const read = (path: string) => readFileSync(join(repositoryRoot, path), "utf8");

const BASE_MIGRATION_VERSION = "20260813013200";
const REPAIR_MIGRATION_VERSION = "20260813013300";
const LATER_MIGRATION_VERSION = "20260813020000";
const baseMigration = read(
  `supabase/migrations/${BASE_MIGRATION_VERSION}_recheck_csf_activity_partner_authorization_under_lock.sql`,
);
const repairMigrationPath = `supabase/migrations/${REPAIR_MIGRATION_VERSION}_close_csf_representative_and_publication_races.sql`;
const repairMigration = existsSync(join(repositoryRoot, repairMigrationPath))
  ? read(repairMigrationPath)
  : "";
const concurrencyTest = [
  "supabase/tests/database/csf_activity_partner_authorization_recheck.test.sql",
  "supabase/tests/database/csf_activity_partner_authorization_controls.test.sql",
]
  .map(read)
  .join("\n");
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

function operationMigration(_name: string): string {
  return baseMigration;
}

function functionBody(name: string): string {
  const migration = operationMigration(name);
  const start = migration.indexOf(`CREATE FUNCTION plugin_data.${name}(`);
  const next = migration.indexOf("CREATE FUNCTION plugin_data.", start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  return migration.slice(start, next < 0 ? migration.length : next);
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("CSF activity and partner mutation authorization lock boundary", () => {
  test("the repair is ordered after #174, #158, and the original authorization migration", () => {
    const dependencyMigrationHeads = [
      "20260812203500",
      "20260812215733",
      BASE_MIGRATION_VERSION,
    ];
    const repositoryVersions = readdirSync(
      join(repositoryRoot, "supabase/migrations"),
    )
      .filter((name) => /^\d{14}_.+\.sql$/u.test(name))
      .map((name) => name.slice(0, 14))
      .sort();

    expect(repositoryVersions).toContain(REPAIR_MIGRATION_VERSION);
    expect(repositoryVersions).toContain(LATER_MIGRATION_VERSION);
    expect(
      REPAIR_MIGRATION_VERSION.localeCompare(LATER_MIGRATION_VERSION),
    ).toBeLessThan(0);
    for (const head of dependencyMigrationHeads) {
      expect(REPAIR_MIGRATION_VERSION.localeCompare(head)).toBeGreaterThan(0);
    }
    expect(repositoryVersions).not.toContain("20260812162732");
    expect(repairMigration).not.toContain("20260812162732");
    expect(repairMigration).not.toContain("content_reports");
    expect(repairMigration).not.toContain(
      "reconcile_project_lifecycle_boundaries",
    );
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

  test("all nine prior transactions remain behind owner-only implementations", () => {
    for (const operation of operations) {
      const migration = operationMigration(operation.name);
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

  test("the replaced publication implementation grants only its reviewed owner", () => {
    expect(repairMigration).toMatch(
      /REVOKE ALL ON FUNCTION plugin_data\.csf_set_activity_status_locked_impl\([\s\S]*?FROM PUBLIC, anon, authenticated, service_role;[\s\S]*?GRANT EXECUTE ON FUNCTION plugin_data\.csf_set_activity_status_locked_impl\([\s\S]*?TO postgres;/u,
    );
    expect(repairMigration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION plugin_data\.csf_set_activity_status_locked_impl\([\s\S]*?TO (?:PUBLIC|anon|authenticated|service_role);/u,
    );
  });

  test("only the unchanged stable signatures are explicitly service-callable", () => {
    for (const operation of operations) {
      const migration = operationMigration(operation.name);
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
    const migrations = baseMigration + repairMigration;
    expect(migrations).not.toContain("CREATE EVENT TRIGGER");
    expect(migrations).not.toContain("GRANT EXECUTE ON ALL FUNCTIONS");
    expect(migrations).not.toMatch(
      /GRANT[\s\S]{0,80}TO (anon|authenticated|PUBLIC)/u,
    );
  });

  test("activity publication takes the close-term lock and rechecks the open term under lock", () => {
    const start = repairMigration.indexOf(
      "CREATE OR REPLACE FUNCTION plugin_data.csf_set_activity_status_locked_impl(",
    );
    const end = repairMigration.indexOf("\n$$;", start);
    const body = repairMigration.slice(start, end);
    const termDiscovery = body.indexOf("SELECT activity.term_id");
    const termDiscoveryTarget = body.indexOf(
      "INTO v_lock_term_id",
      termDiscovery,
    );
    const termAdvisoryLock = body.indexOf(
      "p_organization_id::text || ':' || v_lock_term_id::text",
    );
    const activityLock = body.indexOf(
      "FROM plugin_data.csf_opportunities AS activity",
      termAdvisoryLock,
    );
    const termRowLock = body.indexOf(
      "FROM plugin_data.csf_terms AS term",
      activityLock,
    );
    const openTermCheck = body.indexOf(
      "v_term.lifecycle_status <> 'open'",
      termRowLock,
    );
    const targetWrite = body.indexOf(
      "UPDATE plugin_data.csf_opportunities",
      openTermCheck,
    );

    expect(start).toBeGreaterThanOrEqual(0);
    expect(termDiscovery).toBeGreaterThanOrEqual(0);
    expect(termDiscovery).toBeLessThan(termDiscoveryTarget);
    expect(termDiscoveryTarget).toBeLessThan(termAdvisoryLock);
    expect(termAdvisoryLock).toBeLessThan(activityLock);
    expect(activityLock).toBeLessThan(termRowLock);
    expect(termRowLock).toBeLessThan(openTermCheck);
    expect(openTermCheck).toBeLessThan(targetWrite);
    expect(body).toContain("term.id = v_before.term_id");
    expect(body).toContain("FOR UPDATE");
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
      expect(operation.caller).toMatch(
        new RegExp(`\\.rpc\\(\\s*"${escaped(operation.name)}"`),
      );
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

    const rpcCallSites = [opportunityActions, partnerClubActions].flatMap(
      (caller) =>
        [...caller.matchAll(/\.rpc\(\s*"(csf_[a-z_]+)"/gu)].map(
          (match) => match[1],
        ),
    );
    for (const operation of operations) {
      expect(rpcCallSites).toContain(operation.name);
    }
  });
});
