#!/usr/bin/env node

import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import {
  getCsfIsolatedSupabaseEnv,
  getLocalSupabaseEnv,
} from "./dv-local-env.mjs";
import {
  linkDvhsCsfFixtureProject,
  seedDvhsCsfFixtures,
} from "./seed-platform-csf-plan.mjs";
import {
  buildSeedFixtureSets,
  fixtureJoinCode,
  IDS,
  resolveFixturePassword,
} from "./seed-platform-fixtures.mjs";

// ---------------------------------------------------------------------------
// Explicit, typo-safe seed mode. This is the first thing that runs.
//
// This script deletes and reset-upserts dozens of CSF tables. It used to call
// getLocalSupabaseEnv() unconditionally, which meant a run without
// CSF_ISOLATED_WORK_DIR silently selected the *shared* local 54321 stack and
// then wiped its CSF data. The stack it destroys must be stated by the caller,
// never inferred from which environment variables happen to be exported.
//
// There are exactly three modes, no default, and no cross-mode fallback. A
// missing, empty, or misspelled value fails here — before the fixture password,
// before either environment helper, before the client, before the Supabase CLI,
// and before any database access.
// ---------------------------------------------------------------------------
const PLATFORM_SEED_MODES = [
  "shared-local-v1",
  "csf-isolated-v1",
  "hosted-development-v1",
];
const PRODUCTION_SUPABASE_PROJECT_REF = "fotdmeakexgrkronxlof";

function resolvePlatformSeedMode(env = process.env) {
  const requested = env.PLATFORM_SEED_MODE;

  if (typeof requested !== "string" || requested.length === 0) {
    throw new Error(
      "PLATFORM_SEED_MODE is required and has no default. Use exactly " +
        "PLATFORM_SEED_MODE=shared-local-v1 (bun run supabase:seed:local-dev) for the " +
        "shared local stack, or PLATFORM_SEED_MODE=csf-isolated-v1 " +
        "(bun run csf:seed:platform:isolated) for a generated CSF isolated stack, or " +
        "PLATFORM_SEED_MODE=hosted-development-v1 (bun run csf:seed:hosted-development) " +
        "for the persistent hosted development branch.",
    );
  }

  if (!PLATFORM_SEED_MODES.includes(requested)) {
    throw new Error(
      `Unknown PLATFORM_SEED_MODE: ${requested}. Expected exactly one of ` +
        `${PLATFORM_SEED_MODES.join(", ")}. Refusing to guess which stack to seed.`,
    );
  }

  const isolatedWorkDir = env.CSF_ISOLATED_WORK_DIR?.trim();

  if (requested === "shared-local-v1" && isolatedWorkDir) {
    throw new Error(
      "PLATFORM_SEED_MODE=shared-local-v1 refuses CSF_ISOLATED_WORK_DIR. A shared-local " +
        "seed must never be pointed at a generated isolated stack; run " +
        "bun run csf:seed:platform:isolated instead.",
    );
  }

  if (requested === "csf-isolated-v1" && !isolatedWorkDir) {
    throw new Error(
      "PLATFORM_SEED_MODE=csf-isolated-v1 requires CSF_ISOLATED_WORK_DIR from " +
        "scripts/local-dev/start-dvhs-csf-isolated-stack.sh. It never falls back to the " +
        "shared local stack.",
    );
  }

  if (requested === "hosted-development-v1" && isolatedWorkDir) {
    throw new Error(
      "PLATFORM_SEED_MODE=hosted-development-v1 refuses CSF_ISOLATED_WORK_DIR. " +
        "Hosted development and local isolated targets can never be combined.",
    );
  }

  return requested;
}

const PLATFORM_SEED_MODE = resolvePlatformSeedMode();

// The one place the mode turns into behavior.
//
// This used to be false only in name: both modes ran the whole DVHS CSF fixture
// footprint, so `bun run supabase:seed:local-dev` deleted and reset-upserted
// dozens of CSF tables on the shared local stack while the runbooks described it
// as the non-CSF path. Isolated mode keeps the deterministic synthetic CSF
// fixtures the browser and replay acceptance path depends on; shared local mode
// now creates, replaces, and deletes none of them.
const SEEDS_DVHS_CSF = PLATFORM_SEED_MODE !== "shared-local-v1";

function getHostedDevelopmentSupabaseEnv(env = process.env) {
  const projectRef =
    env.EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF?.trim().toLowerCase();
  if (!projectRef || !/^[a-z0-9]{20}$/u.test(projectRef)) {
    throw new Error(
      "Hosted development seeding requires a valid EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF.",
    );
  }
  if (projectRef === PRODUCTION_SUPABASE_PROJECT_REF) {
    throw new Error(
      "Hosted development seeding refuses the Production Supabase project ref.",
    );
  }

  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const expectedUrl = `https://${projectRef}.supabase.co`;
  if (url !== expectedUrl) {
    throw new Error(
      `Hosted development seeding requires NEXT_PUBLIC_SUPABASE_URL to equal ${expectedUrl}.`,
    );
  }

  const serviceRoleKey =
    env.SUPABASE_SECRET_KEY?.trim() ||
    env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    env.SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    throw new Error(
      "Hosted development seeding requires SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return { url, serviceRoleKey };
}

function resolveSeedSupabaseEnv() {
  // Each mode reaches exactly one helper. The isolated helper enforces the
  // strict generated-stack contract and scopes its `supabase status` to the
  // validated work directory; the shared helper is only ever reached in
  // shared-local-v1, which has already refused an isolated work directory.
  if (PLATFORM_SEED_MODE === "csf-isolated-v1") {
    return getCsfIsolatedSupabaseEnv();
  }
  if (PLATFORM_SEED_MODE === "hosted-development-v1") {
    return getHostedDevelopmentSupabaseEnv();
  }
  return getLocalSupabaseEnv();
}

// ---------------------------------------------------------------------------
// Hermetic execution-plan ledger — test-only, and unreachable without the exact
// opt-in value.
//
// "Which tables does this mode actually touch?" is not answerable by reading
// 2,800 lines of fixture data, and a filename or string assertion would only
// prove the source mentions a table. This seam runs the real main() against a
// recording client that performs no I/O of any kind and appends one JSON line
// per database call, so "shared local mode performs zero DVHS CSF mutations" is
// a checked ledger rather than a grep. No Supabase client is constructed on this
// path, so it can never reach a database.
// ---------------------------------------------------------------------------
const PLATFORM_SEED_PLAN_MODE = "hermetic-plan-v1";

function resolvePlanLedgerPath(env = process.env) {
  const requested = env.PLATFORM_SEED_PLAN_LEDGER?.trim();
  if (!requested) return null;
  if (env.PLATFORM_SEED_PLAN_ONLY !== PLATFORM_SEED_PLAN_MODE) {
    throw new Error(
      "PLATFORM_SEED_PLAN_LEDGER is a test-only seam; it requires " +
        `PLATFORM_SEED_PLAN_ONLY=${PLATFORM_SEED_PLAN_MODE}.`,
    );
  }
  return requested;
}

const PLAN_LEDGER_PATH = resolvePlanLedgerPath();

function syntheticLedgerId(seed) {
  const hash = createHash("sha256").update(seed).digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `8${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}

/**
 * A Supabase-shaped recorder. It opens no socket, reads no credential, and
 * returns the rows it was handed so the fixture code downstream behaves exactly
 * as it would against a real database.
 */
function createPlanRecordingClient(ledgerPath) {
  let sequence = 0;
  const record = (entry) => {
    sequence += 1;
    appendFileSync(
      ledgerPath,
      `${JSON.stringify({ seq: sequence, ...entry })}\n`,
    );
  };

  const settle = (data) => {
    const settled = Promise.resolve({ data, error: null });
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      single: () =>
        Promise.resolve({
          data: Array.isArray(data) ? (data[0] ?? null) : data,
          error: null,
        }),
      maybeSingle: () =>
        Promise.resolve({
          data: Array.isArray(data) ? (data[0] ?? null) : data,
          error: null,
        }),
      then: (onFulfilled, onRejected) => settled.then(onFulfilled, onRejected),
      catch: (onRejected) => settled.catch(onRejected),
      finally: (onFinally) => settled.finally(onFinally),
    };
    return chain;
  };

  const writeRows = (schema, table, op, rows) => {
    const list = (Array.isArray(rows) ? rows : [rows]).map((row, index) => ({
      ...row,
      id: row?.id ?? syntheticLedgerId(`${schema}.${table}:${op}:${index}`),
    }));
    record({ schema, table, op, rows: list.length });
    return settle(list);
  };

  const clientForSchema = (schema) => ({
    schema: (next) => clientForSchema(next),
    from: (table) => ({
      upsert: (rows) => writeRows(schema, table, "upsert", rows),
      insert: (rows) => writeRows(schema, table, "insert", rows),
      update: () => {
        record({ schema, table, op: "update" });
        return settle(null);
      },
      delete: () => {
        record({ schema, table, op: "delete" });
        return settle(null);
      },
      select: () => settle([]),
    }),
    rpc: (name) => {
      record({ schema, rpc: name, op: "rpc" });
      return settle(null);
    },
    auth: {
      admin: {
        listUsers: async () => {
          record({ schema: "auth", op: "auth.listUsers" });
          return { data: { users: [] }, error: null };
        },
        createUser: async (payload) => {
          record({
            schema: "auth",
            op: "auth.createUser",
            email: payload.email,
          });
          return {
            data: {
              user: {
                id: syntheticLedgerId(`auth:${payload.email}`),
                email: payload.email,
              },
            },
            error: null,
          };
        },
        updateUserById: async (id) => {
          record({ schema: "auth", op: "auth.updateUserById" });
          return { data: { user: { id } }, error: null };
        },
      },
    },
  });

  return clientForSchema("public");
}

if (process.argv.slice(2).includes("--print-resolved-target")) {
  // Non-seeding introspection seam. It resolves the mode and the validated
  // target, prints the mode and the API origin only — never a credential — and
  // exits before the fixture password, the client, and every database call.
  const { url } = resolveSeedSupabaseEnv();
  process.stdout.write(`mode=${PLATFORM_SEED_MODE}\nurl=${url}\n`);
  process.exit(0);
}

const fixturePassword = resolveFixturePassword();
const { seededAccounts, seededPluginKeys, seededPluginCatalogRows } =
  buildSeedFixtureSets(SEEDS_DVHS_CSF);
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retrySupabaseAuthRequest(label, operation) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const result = await operation();
    if (!result.error) return result;

    lastError = result.error;
    const status = result.error.status;
    const retryable =
      status === 502 ||
      status === 503 ||
      status === 504 ||
      status === undefined;
    if (!retryable || attempt === 5) break;
    await sleep(500 * attempt);
  }

  throw new Error(
    `${label} failed: ${lastError?.message ?? "unknown Supabase Auth error"}`,
  );
}

async function upsertAuthUser(admin, account) {
  const { data: listed } = await retrySupabaseAuthRequest(
    "List local auth users",
    () =>
      admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      }),
  );

  const existing = listed.users.find(
    (user) => user.email?.toLowerCase() === account.email,
  );

  const payload = {
    password: fixturePassword,
    email_confirm: true,
    ...(account.superAdmin
      ? {
          app_metadata: {
            role: "super_admin",
            is_super_admin: true,
            local_fixture: true,
          },
        }
      : {}),
    user_metadata: {
      full_name: account.fullName,
      avatar_url: account.avatarUrl,
      username: account.email.split("@")[0].replaceAll(".", "-"),
      has_completed_onboarding: true,
      has_completed_intro_tour: true,
      local_fixture: true,
    },
  };

  if (existing) {
    const { data, error } = await admin.auth.admin.updateUserById(
      existing.id,
      payload,
    );
    if (error) throw error;
    return data.user;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: account.email,
    ...payload,
  });
  if (error) throw error;
  return data.user;
}

async function syncFixturePublicProfile({ url, serviceRoleKey, account, id }) {
  // PostgREST intentionally does not let the service-role API mutate public
  // profiles as a substitute for the authenticated owner. Sign in as the
  // run-scoped fictional account and exercise the ordinary self-update policy.
  const fixtureClient = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: session, error: signInError } =
    await fixtureClient.auth.signInWithPassword({
      email: account.email,
      password: fixturePassword,
    });
  if (signInError) throw signInError;
  if (session.user?.id !== id) {
    throw new Error(`Fixture profile identity mismatch for ${account.email}.`);
  }

  const { error: profileError } = await fixtureClient
    .from("profiles")
    .update({
      full_name: account.fullName,
      avatar_url: account.avatarUrl ?? null,
      username: account.email.split("@")[0].replaceAll(".", "-"),
    })
    .eq("id", id);
  if (profileError) throw profileError;
}

async function must(label, promise) {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function main() {
  const { url, serviceRoleKey } = resolveSeedSupabaseEnv();
  console.log(
    `Seeding platform fixtures in ${PLATFORM_SEED_MODE} mode against ${url}`,
  );
  const admin = PLAN_LEDGER_PATH
    ? createPlanRecordingClient(PLAN_LEDGER_PATH)
    : createClient(url, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

  const users = {};
  for (const account of seededAccounts) {
    users[account.key] = await upsertAuthUser(admin, account);
  }

  // The auth insertion trigger creates the public profile only once. Updating
  // an existing fixture user's auth metadata does not resynchronize that row,
  // so reseeds must explicitly keep the visible identity fictional too. This
  // also clears a previously seeded portrait when `avatarUrl` is null.
  for (const account of seededAccounts) {
    if (PLAN_LEDGER_PATH) {
      await must(
        `fixture public profile ${account.key}`,
        admin
          .from("profiles")
          .update({
            full_name: account.fullName,
            avatar_url: account.avatarUrl ?? null,
          })
          .eq("id", users[account.key].id),
      );
      continue;
    }
    await syncFixturePublicProfile({
      url,
      serviceRoleKey,
      account,
      id: users[account.key].id,
    });
  }

  await must(
    "trusted-member-developer",
    admin.from("trusted_member").upsert(
      {
        id: users.developer.id,
        user_id: users.developer.id,
        name: "Platform Admin Fixture",
        email: "platform.admin@local.test",
        status: true,
        reason: "Developer admin access",
      },
      { onConflict: "id" },
    ),
  );

  const organizations = [
    {
      id: IDS.primaryOrg,
      name: "Local Platform Org",
      username: "local-platform-org",
      type: "nonprofit",
      description:
        "Default local organization for plugin platform and data-isolation testing.",
      show_members_publicly: true,
      join_code: fixtureJoinCode("local-platform-org"),
      created_by: users.developer.id,
    },
    {
      id: IDS.nonprofitOrg,
      name: "Acts of Hearts",
      username: "acts-of-hearts",
      type: "nonprofit",
      description:
        "Local nonprofit fixture for public project and organization workflows.",
      show_members_publicly: true,
      join_code: fixtureJoinCode("acts-of-hearts"),
      created_by: users.developer.id,
    },
    {
      id: IDS.schoolOrg,
      name: "Local School Volunteers",
      username: "local-school-volunteers",
      type: "school",
      description:
        "Local school organization fixture for membership isolation checks.",
      show_members_publicly: true,
      join_code: fixtureJoinCode("local-school-volunteers"),
      created_by: users.developer.id,
    },
    {
      id: IDS.csfOrg,
      name: "DVHS CSF",
      username: "dvhs-csf",
      type: "school",
      description:
        "Dougherty Valley High School's California Scholarship Federation chapter.",
      logo_url: "/logos/dvhigh-csf.png",
      show_members_publicly: false,
      join_code: fixtureJoinCode("dvhs-csf"),
      created_by: users.developer.id,
    },
  ];

  // The DVHS CSF organization is itself a CSF record, so shared local mode does
  // not create or replace it — and the membership loop below indexes
  // `account.roles` positionally, which is why csfOrg stays last in both shapes.
  const seededOrganizations = SEEDS_DVHS_CSF
    ? organizations
    : organizations.filter((organization) => organization.id !== IDS.csfOrg);

  await must(
    "organizations",
    admin.from("organizations").upsert(seededOrganizations),
  );

  const orgIds = SEEDS_DVHS_CSF
    ? [IDS.primaryOrg, IDS.nonprofitOrg, IDS.schoolOrg, IDS.csfOrg]
    : [IDS.primaryOrg, IDS.nonprofitOrg, IDS.schoolOrg];
  const membershipRows = [];
  for (const account of seededAccounts) {
    const userId = users[account.key].id;
    for (let orgIdx = 0; orgIdx < orgIds.length; orgIdx += 1) {
      const role = account.roles[orgIdx];
      if (!role) continue;
      membershipRows.push({
        organization_id: orgIds[orgIdx],
        user_id: userId,
        role,
        status: "active",
      });
    }
  }

  await must(
    "organization memberships",
    admin
      .from("organization_members")
      .upsert(membershipRows, { onConflict: "organization_id,user_id" }),
  );

  await must(
    "plugin catalog",
    admin.from("plugins").upsert(seededPluginCatalogRows, {
      onConflict: "key",
    }),
  );

  for (const pluginKey of seededPluginKeys) {
    const entitledOrgIds =
      pluginKey === "dvhs-csf"
        ? [IDS.csfOrg]
        : orgIds.filter((orgId) => orgId !== IDS.csfOrg);
    for (const orgId of entitledOrgIds) {
      await must(
        `entitlement-${pluginKey}-${orgId}`,
        admin.from("organization_plugin_entitlements").upsert(
          {
            organization_id: orgId,
            plugin_key: pluginKey,
            status: "active",
            is_forced: false,
            created_by: users.developer.id,
          },
          { onConflict: "organization_id,plugin_key" },
        ),
      );

      await must(
        `install-${pluginKey}-${orgId}`,
        admin.from("organization_plugin_installs").upsert(
          {
            organization_id: orgId,
            plugin_key: pluginKey,
            enabled: true,
            installed_version: "0.1.0",
            installed_by: users.developer.id,
            configuration: {
              localFixture: true,
              serverOnlyDataAccess: true,
            },
          },
          { onConflict: "organization_id,plugin_key" },
        ),
      );
    }
  }

  // -------------------------------------------------------------------------
  // DVHS CSF fixtures — isolated and hosted-development modes only.
  //
  // Everything between this brace and its close is the deterministic synthetic
  // DVHS CSF footprint the isolated browser and replay acceptance path depends
  // on: the reset list, the roles, terms, cohorts, applications, meetings,
  // opportunities, points, partner clubs, and the owned synthetic import seam.
  // In shared-local-v1 none of it runs, so that mode creates, replaces, and
  // deletes no DVHS CSF record at all.
  //
  // The body deliberately keeps its original indentation. Re-flowing two
  // thousand unchanged lines to add one branch would have hidden the branch.
  // -------------------------------------------------------------------------
  if (SEEDS_DVHS_CSF) {
    await seedDvhsCsfFixtures({ admin, users, must });
  }

  await must(
    "public-project",
    admin.from("projects").upsert({
      id: IDS.publicProject,
      creator_id: SEEDS_DVHS_CSF ? users.csfAdmin.id : users.developer.id,
      organization_id: SEEDS_DVHS_CSF ? IDS.csfOrg : IDS.nonprofitOrg,
      title: SEEDS_DVHS_CSF
        ? "Santa Cruz Beach Cleanup"
        : "Local Community Food Drive",
      location: SEEDS_DVHS_CSF
        ? "Santa Cruz Beach Boardwalk Parking"
        : "San Ramon Community Center",
      description: SEEDS_DVHS_CSF
        ? "A community beach cleanup with shoreline teams, a supply table, and recycling support."
        : "Public local fixture project for discovery, signup, and plugin platform smoke tests.",
      event_type: "oneTime",
      verification_method: "manual",
      schedule: {
        oneTime: {
          date: "2026-12-05",
          startTime: "09:00",
          endTime: "13:00",
          volunteers: 25,
        },
      },
      status: "upcoming",
      visibility: "public",
      require_login: false,
      cover_image_url: "/demo/projects/santa-cruz-beach-cleanup.png",
    }),
  );

  if (SEEDS_DVHS_CSF) {
    // Deferred until the fixture project row exists: the CSF activity links to
    // it by foreign key, and the officer signup panel needs a roster to read.
    await linkDvhsCsfFixtureProject({ admin, users, must });
  }

  await must(
    "org-project",
    admin.from("projects").upsert({
      id: IDS.orgProject,
      creator_id: users.developer.id,
      organization_id: IDS.primaryOrg,
      title: "Local Platform Member Day",
      location: "Local Platform Org",
      description:
        "Organization-scoped fixture project for authenticated local workflows.",
      event_type: "oneTime",
      verification_method: "manual",
      schedule: {
        oneTime: {
          date: "2026-11-14",
          startTime: "10:00",
          endTime: "15:00",
          volunteers: 40,
        },
      },
      status: "upcoming",
      visibility: "organization_only",
      require_login: true,
    }),
  );

  console.log("Seeding complete! Local platform account seeded:");
  console.log({
    email: "platform.admin@local.test",
    role: "admin (all 3 platform orgs)",
    dvPlugin: "catalog enabled; run bun run dv:fixtures for the full workspace",
    dvhsCsf: SEEDS_DVHS_CSF
      ? `${PLATFORM_SEED_MODE}: deterministic synthetic DVHS CSF fixtures seeded`
      : "shared local, non-CSF only: no DVHS CSF record was created, replaced, or deleted",
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
