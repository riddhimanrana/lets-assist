#!/usr/bin/env node

import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import {
  getCsfIsolatedSupabaseEnv,
  getLocalSupabaseEnv,
} from "./dv-local-env.mjs";

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
  const projectRef = env.EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF
    ?.trim()
    .toLowerCase();
  if (!projectRef || !/^[a-z0-9]{20}$/u.test(projectRef)) {
    throw new Error(
      "Hosted development seeding requires a valid EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF.",
    );
  }
  if (projectRef === PRODUCTION_SUPABASE_PROJECT_REF) {
    throw new Error("Hosted development seeding refuses the Production Supabase project ref.");
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
    appendFileSync(ledgerPath, `${JSON.stringify({ seq: sequence, ...entry })}\n`);
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
          record({ schema: "auth", op: "auth.createUser", email: payload.email });
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

const IDS = {
  primaryOrg: "10000000-0000-4000-8000-000000000001",
  nonprofitOrg: "10000000-0000-4000-8000-000000000002",
  schoolOrg: "10000000-0000-4000-8000-000000000003",
  csfOrg: "10000000-0000-4000-8000-000000000004",
  publicProject: "10000000-0000-4000-8000-000000000020",
  orgProject: "10000000-0000-4000-8000-000000000021",
  csfTermS26: "10000000-0000-4000-8000-000000000101",
  csfTermF25: "10000000-0000-4000-8000-000000000114",
  csfCohort2028: "10000000-0000-4000-8000-000000000102",
  csfCohort2027: "10000000-0000-4000-8000-000000000115",
  csfCohort2029: "10000000-0000-4000-8000-000000000116",
  csfProfileMember: "10000000-0000-4000-8000-000000000103",
  csfProfileRestricted: "10000000-0000-4000-8000-000000000104",
  csfProfileOfficer: "10000000-0000-4000-8000-000000000117",
  csfProfileComplete: "10000000-0000-4000-8000-000000000118",
  csfProfilePending: "10000000-0000-4000-8000-000000000119",
  csfProfileMissingHours: "10000000-0000-4000-8000-000000000120",
  csfProfileDuplicate: "10000000-0000-4000-8000-000000000121",
  csfSheetSource: "10000000-0000-4000-8000-000000000105",
  csfSheetJobPreview: "10000000-0000-4000-8000-000000000122",
  csfSheetJobCommit: "10000000-0000-4000-8000-000000000123",
  csfOpportunity: "10000000-0000-4000-8000-000000000106",
  csfOpportunityFoodBank: "10000000-0000-4000-8000-000000000124",
  csfOpportunityCleanup: "10000000-0000-4000-8000-000000000125",
  csfOpportunityTutoring: "10000000-0000-4000-8000-000000000126",
  csfOpportunityDrive: "10000000-0000-4000-8000-000000000127",
  csfActivityOpportunity: "10000000-0000-4000-8000-000000000107",
  csfActivityMeeting: "10000000-0000-4000-8000-000000000108",
  csfMeetingGeneral: "10000000-0000-4000-8000-000000000128",
  csfMeetingService: "10000000-0000-4000-8000-000000000129",
  csfRestriction: "10000000-0000-4000-8000-000000000109",
  csfRoleOwner: "10000000-0000-4000-8000-000000000110",
  csfRoleActivityCoordinator: "10000000-0000-4000-8000-000000000111",
  csfRoleCoPresident: "10000000-0000-4000-8000-000000000130",
  csfRoleSecretary: "10000000-0000-4000-8000-000000000131",
  csfRoleAdvisor: "10000000-0000-4000-8000-000000000132",
  csfRoleVicePresidentMembership: "20000000-0000-4000-8000-000000000001",
  csfRoleVicePresidentPublicity: "20000000-0000-4000-8000-000000000002",
  csfRoleVicePresidentClubs: "20000000-0000-4000-8000-000000000003",
  csfRoleTreasurer: "20000000-0000-4000-8000-000000000004",
  csfRoleWebMaster: "20000000-0000-4000-8000-000000000005",
  csfRoleDataManagement: "20000000-0000-4000-8000-000000000006",
  csfStaffPosition: "10000000-0000-4000-8000-000000000112",
  csfStaffSecretary: "10000000-0000-4000-8000-000000000133",
  csfStaffAdvisor: "20000000-0000-4000-8000-000000000101",
  csfStaffCoPresidentOne: "20000000-0000-4000-8000-000000000102",
  csfStaffCoPresidentTwo: "20000000-0000-4000-8000-000000000103",
  csfStaffVicePresidentMembership: "20000000-0000-4000-8000-000000000104",
  csfStaffVicePresidentPublicity: "20000000-0000-4000-8000-000000000105",
  csfStaffVicePresidentClubs: "20000000-0000-4000-8000-000000000106",
  csfStaffTreasurer: "20000000-0000-4000-8000-000000000107",
  csfStaffWebMaster: "20000000-0000-4000-8000-000000000108",
  csfStaffActivityCoordinatorTwo: "20000000-0000-4000-8000-000000000109",
  csfStaffActivityCoordinatorThree: "20000000-0000-4000-8000-000000000110",
  csfStaffActivityCoordinatorFour: "20000000-0000-4000-8000-000000000111",
  csfStaffActivityCoordinatorFive: "20000000-0000-4000-8000-000000000112",
  csfStaffDataManagement: "20000000-0000-4000-8000-000000000113",
  csfPartnerClub: "10000000-0000-4000-8000-000000000113",
  csfPartnerLibrary: "10000000-0000-4000-8000-000000000134",
  csfPartnerBatch: "10000000-0000-4000-8000-000000000135",
  csfAnnouncementPinned: "10000000-0000-4000-8000-000000000136",
  csfAnnouncementOfficer: "10000000-0000-4000-8000-000000000137",
};

function fixtureJoinCode(seed) {
  const checksum = [...seed].reduce(
    (total, character) => (total * 31 + character.charCodeAt(0)) % 900_000,
    0,
  );
  return String(100_000 + checksum).slice(-6);
}

const fixturePassword =
  process.env.CSF_LOCAL_TEST_PASSWORD ??
  process.env.DV_LOCAL_TEST_PASSWORD;

if (!fixturePassword) {
  throw new Error(
    "Set CSF_LOCAL_TEST_PASSWORD or DV_LOCAL_TEST_PASSWORD before seeding local platform fixtures.",
  );
}

const accounts = [
  {
    key: "developer",
    email: "platform.admin@local.test",
    fullName: "Riddhiman Rana",
    avatarUrl: "/demo/avatars/riddhiman-rana.png",
    superAdmin: true,
    roles: ["admin", "admin", "admin", "admin"],
  },
  {
    key: "staff",
    email: "platform.staff@local.test",
    fullName: "Platform Staff",
    roles: ["staff", "staff", null, null],
  },
  {
    key: "member",
    email: "platform.member@local.test",
    fullName: "Platform Member",
    roles: ["member", null, "member", null],
  },
  {
    key: "outsider",
    email: "platform.outsider@local.test",
    fullName: "Platform Outsider",
    roles: [null, null, null, null],
  },
  {
    key: "csfAdmin",
    email: "csf.admin@local.test",
    fullName: "Riddhiman Rana",
    avatarUrl: "/demo/avatars/riddhiman-rana.png",
    roles: [null, null, null, "admin"],
  },
  {
    key: "csfOfficer",
    email: "csf.officer@local.test",
    fullName: "Priya Shah",
    avatarUrl: "/demo/avatars/priya-shah.png",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfAdviser",
    email: "csf.adviser@local.test",
    fullName: "Dr. Elena Park",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfCoPresidentOne",
    email: "csf.co-president-one@local.test",
    fullName: "Maya Chen",
    avatarUrl: "/demo/avatars/maya-chen.png",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfCoPresidentTwo",
    email: "csf.co-president-two@local.test",
    fullName: "Jordan Lee",
    avatarUrl: "/demo/avatars/jordan-lee.png",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfVpMembership",
    email: "csf.vp-membership@local.test",
    fullName: "Avery Patel",
    avatarUrl: "/demo/avatars/avery-patel.png",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfVpPublicity",
    email: "csf.vp-publicity@local.test",
    fullName: "Sofia Nguyen",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfVpClubs",
    email: "csf.vp-clubs@local.test",
    fullName: "Ethan Wong",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfTreasurer",
    email: "csf.treasurer@local.test",
    fullName: "Nina Brooks",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfSecretary",
    email: "csf.secretary@local.test",
    fullName: "Lena Kim",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfWebMaster",
    email: "csf.web-master@local.test",
    fullName: "Marcus Reed",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfActivityCoordinatorTwo",
    email: "csf.activity-two@local.test",
    fullName: "Grace Lin",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfActivityCoordinatorThree",
    email: "csf.activity-three@local.test",
    fullName: "Noah Singh",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfActivityCoordinatorFour",
    email: "csf.activity-four@local.test",
    fullName: "Isabella Nguyen",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfActivityCoordinatorFive",
    email: "csf.activity-five@local.test",
    fullName: "Lucas Brown",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfDataManagement",
    email: "csf.data-management@local.test",
    fullName: "Aarav Mehta",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfApplicant",
    email: "csf.applicant@local.test",
    fullName: "Evan Chen",
    roles: [null, null, null, "member"],
  },
  {
    key: "csfMember",
    email: "student.2028@local.test",
    fullName: "Aarav Mehta",
    roles: [null, null, null, "member"],
  },
];

// Every CSF fixture actor is a DVHS CSF profile record, so shared local mode
// never creates one. The non-CSF platform accounts are untouched.
const seededAccounts = SEEDS_DVHS_CSF
  ? accounts
  : accounts.filter((account) => !account.key.startsWith("csf"));

const pluginKeys = [
  "calendar-tools",
  "community-impact-radar",
  "dvhs-csf",
  "family-liaison-workbench",
];

const seededPluginKeys = SEEDS_DVHS_CSF
  ? pluginKeys
  : pluginKeys.filter((key) => key !== "dvhs-csf");

const pluginCatalogRows = [
  {
    key: "calendar-tools",
    name: "Calendar Tools",
    description:
      "Server-rendered calendar workflow helpers for organization projects.",
    visibility: "private",
    is_active: true,
    latest_version: "0.1.0",
    private_codebase: true,
  },
  {
    key: "community-impact-radar",
    name: "Community Impact Radar",
    description:
      "Organization impact analytics surfaces backed by host-controlled read paths.",
    visibility: "global",
    is_active: true,
    latest_version: "0.1.0",
    private_codebase: true,
  },
  {
    key: "dvhs-csf",
    name: "DVHS CSF",
    description:
      "Private CSF workflow system for cohort membership, applications, officer roles, points, posts, and sheets.",
    visibility: "private",
    is_active: true,
    latest_version: "0.1.0",
    private_codebase: true,
  },
  {
    key: "family-liaison-workbench",
    name: "Family Liaison Workbench",
    description:
      "Staff-only liaison workflow surfaces for signup and family support pilots.",
    visibility: "private",
    is_active: true,
    latest_version: "0.1.0",
    private_codebase: true,
  },
];

const seededPluginCatalogRows = pluginCatalogRows.filter((row) =>
  seededPluginKeys.includes(row.key),
);

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

async function must(label, promise) {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function main() {
  const { url, serviceRoleKey } = resolveSeedSupabaseEnv();
  console.log(`Seeding platform fixtures in ${PLATFORM_SEED_MODE} mode against ${url}`);
  const admin = PLAN_LEDGER_PATH
    ? createPlanRecordingClient(PLAN_LEDGER_PATH)
    : createClient(url, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

  const users = {};
  for (const account of seededAccounts) {
    users[account.key] = await upsertAuthUser(admin, account);
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
  const pluginDb = admin.schema("plugin_data");
  const csfTablesToReset = [
    "csf_storage_deletion_queue",
    "csf_profile_activity_events",
    "csf_profile_merge_reviews",
    "csf_profile_link_requests",
    "csf_sheet_sync_logs",
    // csf_sheet_import_rows, csf_sheet_import_jobs and csf_sheet_sources are
    // absent deliberately: they are SELECT-only to service_role, so a direct
    // delete cannot succeed. csf_seed_reset_synthetic_import below retires them
    // through the owned fixture seam, which refuses any organization outside the
    // reserved synthetic UUID namespace.
    "csf_partner_submission_rows",
    "csf_partner_submission_batches",
    "csf_partner_club_terms",
    "csf_partner_club_aliases",
    "csf_partner_clubs",
    "csf_onboarding_links",
    "csf_meeting_attendance",
    "csf_meeting_sessions",
    "csf_meetings",
    "csf_term_meetings",
    "csf_point_appeals",
    "csf_submission_reviews",
    "csf_credit_records",
    "csf_submission_files",
    "csf_point_submissions",
    "csf_term_point_rules",
    "csf_point_categories",
    "csf_opportunity_signups",
    "csf_opportunities",
    "csf_announcements",
    "csf_profile_restrictions",
    "csf_staff_positions",
    "csf_role_permissions",
    "csf_roles",
    "csf_application_correction_requests",
    "csf_application_private_notes",
    "csf_application_checks",
    "csf_dues_records",
    "csf_application_status_events",
    "csf_application_files",
    "csf_application_course_entries",
    "csf_term_reopen_events",
    "csf_term_membership_outcomes",
    "csf_term_closures",
    "csf_term_memberships",
    "csf_term_applications",
    "csf_profile_cohort_memberships",
    "csf_profile_accounts",
    // Profiles can be referenced by immutable audit rows through
    // actor_profile_id. Deleting them would require updating those audit rows,
    // which correctly fails. Fixed fixture profiles are reset by the upserts
    // below; browser-created claim profiles are de-identified by their own
    // cleanup and remain as historical local evidence until the isolated stack
    // is disposed.
    "csf_cohort_terms",
    "csf_cohorts",
    "csf_term_deadlines",
    "csf_term_policy_drafts",
    "csf_term_policies",
  ];

  // The import footprint first, through the owned seam. It has to precede the
  // generic loop because onboarding links reference sheet sources.
  await must(
    "csf-reset-synthetic-import",
    pluginDb.rpc("csf_seed_reset_synthetic_import", { p_organization_id: IDS.csfOrg }),
  );

  for (const table of csfTablesToReset) {
    await must(
      `csf-reset-${table}`,
      pluginDb.from(table).delete().eq("organization_id", IDS.csfOrg),
    );
  }

  await must(
    "csf-roles",
    pluginDb.from("csf_roles").upsert(
      [
        {
          id: IDS.csfRoleOwner,
          organization_id: IDS.csfOrg,
          key: "owner",
          display_name: "CSF Owner",
          description: "Root CSF plugin owner identity.",
          role_type: "owner",
          is_system: true,
          sort_order: 0,
        },
        {
          id: IDS.csfRoleActivityCoordinator,
          organization_id: IDS.csfOrg,
          key: "activity-coordinator",
          display_name: "Activity Coordinator",
          description: "Creates CSF posts and verifies participation.",
          role_type: "officer_template",
          is_system: true,
          sort_order: 60,
        },
      ],
      { onConflict: "organization_id,key" },
    ),
  );

  await must(
    "csf-role-permissions",
    pluginDb.from("csf_role_permissions").upsert(
      [
        {
          organization_id: IDS.csfOrg,
          role_id: IDS.csfRoleOwner,
          permission_key: "manage_settings",
          enabled: true,
        },
        {
          organization_id: IDS.csfOrg,
          role_id: IDS.csfRoleActivityCoordinator,
          permission_key: "manage_opportunities",
          enabled: true,
        },
        {
          organization_id: IDS.csfOrg,
          role_id: IDS.csfRoleActivityCoordinator,
          permission_key: "verify_participation",
          enabled: true,
        },
      ],
      { onConflict: "role_id,permission_key" },
    ),
  );

  await must(
    "csf-staff-position",
    pluginDb.from("csf_staff_positions").upsert({
      id: IDS.csfStaffPosition,
      organization_id: IDS.csfOrg,
      user_id: users.csfOfficer.id,
      role_id: IDS.csfRoleActivityCoordinator,
      school_year: "2025-2026",
      display_title: "Activity Coordinator",
      status: "active",
      appointed_by: users.developer.id,
      notes: "Local fixture officer.",
    }),
  );

  await must(
    "csf-clear-current-terms",
    pluginDb
      .from("csf_terms")
      .update({ is_current: false })
      .eq("organization_id", IDS.csfOrg),
  );

  await must(
    "csf-term-s26",
    pluginDb.from("csf_terms").upsert(
      {
        id: IDS.csfTermS26,
        organization_id: IDS.csfOrg,
        code: "S26",
        label: "Spring 2026",
        school_year: "2025-2026",
        semester: "spring",
        is_current: true,
      },
      { onConflict: "organization_id,code" },
    ),
  );

  await must(
    "csf-cohort-2028",
    pluginDb.from("csf_cohorts").upsert(
      {
        id: IDS.csfCohort2028,
        organization_id: IDS.csfOrg,
        graduation_year: 2028,
        label: "Class of 2028",
        status: "active",
      },
      { onConflict: "organization_id,graduation_year" },
    ),
  );

  await must(
    "csf-cohort-term",
    pluginDb.from("csf_cohort_terms").upsert(
      {
        organization_id: IDS.csfOrg,
        cohort_id: IDS.csfCohort2028,
        term_id: IDS.csfTermS26,
        grade_level: 10,
        sheet_tab_name: "S26",
      },
      { onConflict: "cohort_id,term_id" },
    ),
  );

  await must(
    "csf-profiles",
    pluginDb.from("csf_profiles").upsert([
      {
        id: IDS.csfProfileMember,
        organization_id: IDS.csfOrg,
        first_name: "Aarav",
        last_name: "Mehta",
        preferred_name: "Aarav",
        school_email: "aarav.mehta28@students.local.test",
        personal_email: "student.2028@local.test",
        normalized_first_name: "aarav",
        normalized_last_name: "mehta",
        normalized_school_email: "aarav.mehta28@students.local.test",
        normalized_personal_email: "student.2028@local.test",
        source_summary: { localFixture: true },
      },
      {
        id: IDS.csfProfileRestricted,
        organization_id: IDS.csfOrg,
        first_name: "Nina",
        last_name: "Kapoor",
        school_email: "nina.kapoor28@students.local.test",
        normalized_first_name: "nina",
        normalized_last_name: "kapoor",
        normalized_school_email: "nina.kapoor28@students.local.test",
        source_summary: { localFixture: true },
      },
    ]),
  );

  await must(
    "csf-profile-memberships",
    pluginDb.from("csf_profile_cohort_memberships").upsert(
      [
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfileMember,
          cohort_id: IDS.csfCohort2028,
          status: "active",
        },
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfileRestricted,
          cohort_id: IDS.csfCohort2028,
          status: "active",
        },
      ],
      { onConflict: "profile_id,cohort_id" },
    ),
  );

  await must(
    "csf-profile-account",
    pluginDb.from("csf_profile_accounts").upsert(
      {
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfileMember,
        user_id: users.csfMember.id,
        status: "verified",
        is_primary: true,
        linked_by: users.developer.id,
      },
      { onConflict: "organization_id,profile_id,user_id" },
    ),
  );

  await must(
    "csf-point-rules",
    pluginDb.from("csf_term_point_rules").upsert(
      [
        {
          organization_id: IDS.csfOrg,
          term_id: IDS.csfTermS26,
          point_type: "drive",
          label: "Drive points",
          min_required: 0,
          max_counted: 2,
          is_required: false,
          display_order: 10,
        },
        {
          organization_id: IDS.csfOrg,
          term_id: IDS.csfTermS26,
          point_type: "non_drive",
          label: "Non-drive points",
          min_required: 5,
          max_counted: 5,
          is_required: true,
          display_order: 20,
        },
      ],
      { onConflict: "organization_id,term_id,point_type" },
    ),
  );

  await must(
    "csf-sheet-source",
    pluginDb.rpc("csf_seed_synthetic_import_fixture", {
      p_organization_id: IDS.csfOrg,
      p_sources: [{
        id: IDS.csfSheetSource,
        cohortId: IDS.csfCohort2028,
        // Stated explicitly rather than defaulted: the fixture seam applies
        // column defaults, but a roster source whose kind, target strategy and
        // access state were implicit is not the row the workspace reads.
        sourceType: "student_roster",
        targetStrategy: "fixed",
        driveAccessState: "accessible",
        title: "Class of 2028 workbook",
        provider: "google_sheets",
        spreadsheetId: "local-csf-sheet-fixture",
        sheetUrl:
          "https://docs.google.com/spreadsheets/d/local-csf-sheet-fixture",
        syncOwnerUserId: users.developer.id,
        syncMode: "manual",
        syncStatus: "needs_attention",
        lastSyncStatus: "preview_completed",
        lastSyncError: "2 rows need officer review before commit.",
        lastPreviewedAt: "2026-03-18T18:10:00-07:00",
        lastCommittedAt: "2026-03-17T17:30:00-07:00",
        lastSyncedAt: "2026-03-17T17:30:00-07:00",
        duplicatePolicy: "match_email_then_name",
        columnMappings: {
          firstName: "First",
          lastName: "Last",
          schoolEmail: "SRVUSD Email",
          personalEmail: "Most Checked Email",
          activities: "Activity 1..7",
          meetings: "Meeting*",
          requirementsMet: "All Reqs Met?",
        },
        tabMappings: [
          {
            cohortYear: 2028,
            termCode: "S26",
            tabName: "S26",
            rangeA1: "A1:Z1000",
          },
        ],
        settings: {
          sourceKind: "student_roster",
          mappingVersion: 1,
          selectedTabs: ["S26"],
        },
      }],
    }),
  );

  await must(
    "csf-onboarding-link",
    pluginDb.from("csf_onboarding_links").upsert(
      {
        organization_id: IDS.csfOrg,
        term_id: IDS.csfTermS26,
        cohort_id: IDS.csfCohort2028,
        sheet_source_id: IDS.csfSheetSource,
        code: "S26-2028",
        title: "Spring 2026 Class of 2028",
        link_type: "combined",
        google_form_url:
          "https://docs.google.com/forms/d/local-csf-form-fixture/viewform",
        landing_message:
          "Connect your Let’s Assist profile, then complete the official CSF Google Form.",
        is_active: true,
        created_by: users.developer.id,
      },
      { onConflict: "organization_id,code" },
    ),
  );

  await must(
    "csf-opportunity",
    pluginDb.from("csf_opportunities").upsert({
      id: IDS.csfOpportunity,
      organization_id: IDS.csfOrg,
      term_id: IDS.csfTermS26,
      title: "Quail Run Suessical Musical",
      body: "Quail Run is hosting their Suessical Musical and has volunteer slots open.",
      starts_at: "2026-05-08T17:15:00-07:00",
      ends_at: "2026-05-08T19:15:00-07:00",
      location: "Quail Run Elementary School",
      signup_url:
        "https://docs.google.com/spreadsheets/d/local-quail-run-signup/edit",
      contact_email: "quailrun.csf@example.test",
      point_value: 2,
      point_type: "non_drive",
      signup_mode: "external",
      requires_point_submission: true,
      evidence_policy: "optional",
      source_organization: "Quail Run Elementary School",
      created_by_user_id: users.csfOfficer.id,
      status: "published",
      external_sheet_url:
        "https://docs.google.com/spreadsheets/d/local-quail-run-signup/edit",
      sheet_export_status: "not_exported",
      published_at: "2026-05-07T12:00:00-07:00",
    }),
  );

  await must(
    "csf-partner-club",
    pluginDb.from("csf_partner_clubs").upsert(
      {
        id: IDS.csfPartnerClub,
        organization_id: IDS.csfOrg,
        name: "Quail Run Elementary School",
        contact_name: "Quail Run Volunteer Office",
        contact_email: "quailrun.csf@example.test",
        approved_point_types: ["non_drive"],
        notes: "Fixture partner source for imported participant sheets.",
        status: "active",
        created_by: users.csfOfficer.id,
      },
      { onConflict: "organization_id,name" },
    ),
  );

  await must(
    "csf-activity-events",
    pluginDb.from("csf_profile_activity_events").upsert([
      {
        id: IDS.csfActivityOpportunity,
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfileMember,
        term_id: IDS.csfTermS26,
        opportunity_id: IDS.csfOpportunity,
        event_type: "opportunity",
        title: "Quail Run Suessical Musical",
        description: "Imported local fixture credit.",
        event_at: "2026-05-08T19:15:00-07:00",
        point_type: "non_drive",
        raw_points: 2,
        counted_points: 2,
        status: "verified",
        source: "manual",
        source_ref: { localFixture: true },
      },
      {
        id: IDS.csfActivityMeeting,
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfileMember,
        term_id: IDS.csfTermS26,
        event_type: "meeting",
        title: "Spring General Meeting",
        event_at: "2026-02-03T15:45:00-08:00",
        point_type: "meeting",
        raw_points: 1,
        counted_points: 1,
        status: "verified",
        source: "legacy_import",
        source_ref: { localFixture: true },
      },
    ]),
  );

  await must(
    "csf-restriction",
    pluginDb.from("csf_profile_restrictions").upsert({
      id: IDS.csfRestriction,
      organization_id: IDS.csfOrg,
      profile_id: IDS.csfProfileRestricted,
      scope: "manual_review_required",
      status: "active",
      reason_category: "local_fixture",
      private_notes:
        "Fixture profile used to verify staff-only restriction handling.",
      visible_message: "Your CSF profile needs staff review.",
      created_by: users.developer.id,
    }),
  );

  const csfPermissionKeys = [
    "manage_roles",
    "manage_cohorts_terms",
    "manage_schedule",
    "manage_profiles",
    "review_applications",
    "view_applications",
    "review_application_checks",
    "decide_applications",
    "assign_applications",
    "write_application_notes",
    "manage_restrictions",
    "manage_opportunities",
    "manage_partner_clubs",
    "verify_participation",
    "process_points",
    "verify_submissions",
    "manage_meetings",
    "reconcile_meeting_attendance",
    "close_term",
    "reopen_term",
    "edit_point_rules",
    "manage_payment_review",
    "import_applications",
    "import_members",
    "import_meetings",
    "import_partner_clubs",
    "manage_sheet_sync",
    "resolve_imports",
    "manage_settings",
    "export_membership_reports",
    "export_dues_reports",
    "export_service_reports",
    "export_club_reports",
    "export_reports",
    "export_sensitive_reports",
    "view_audit_history",
  ];

  const seededRoles = [
    {
      id: IDS.csfRoleOwner,
      key: "owner",
      display_name: "CSF Owner",
      description: "Root CSF plugin owner identity.",
      role_type: "owner",
      sort_order: 0,
      public_title: "CSF Owner",
      responsibility_label: "Platform administration",
      max_active_seats: 1,
      permissions: csfPermissionKeys,
    },
    {
      id: IDS.csfRoleCoPresident,
      key: "co-president",
      display_name: "Co-President",
      description:
        "General CSF operations and final decisions, excluding owner transfer, adviser academic override, and semester close or reopen.",
      role_type: "officer_template",
      sort_order: 20,
      public_title: "Co-President",
      responsibility_label: null,
      max_active_seats: 2,
      permissions: csfPermissionKeys.filter(
        (permission) =>
          !["manage_roles", "close_term", "reopen_term"].includes(permission),
      ),
    },
    {
      id: IDS.csfRoleVicePresidentMembership,
      key: "vice-president-membership",
      display_name: "Vice President — Membership",
      description:
        "Applications, member records, meetings, points, imports, and operational reports.",
      role_type: "officer_template",
      sort_order: 30,
      public_title: "Vice President",
      responsibility_label: "Membership",
      max_active_seats: 1,
      permissions: [
        "manage_profiles",
        "review_applications",
        "view_applications",
        "review_application_checks",
        "decide_applications",
        "assign_applications",
        "write_application_notes",
        "manage_payment_review",
        "manage_meetings",
        "reconcile_meeting_attendance",
        "process_points",
        "verify_submissions",
        "import_applications",
        "import_members",
        "import_meetings",
        "export_membership_reports",
        "export_service_reports",
      ],
    },
    {
      id: IDS.csfRoleVicePresidentPublicity,
      key: "vice-president-publicity",
      display_name: "Vice President — Publicity",
      description: "Activities and CSF public content.",
      role_type: "officer_template",
      sort_order: 40,
      public_title: "Vice President",
      responsibility_label: "Publicity",
      max_active_seats: 1,
      permissions: ["manage_opportunities"],
    },
    {
      id: IDS.csfRoleVicePresidentClubs,
      key: "vice-president-clubs",
      display_name: "Vice President — Clubs",
      description:
        "Partner clubs, club imports, point verification, and reports.",
      role_type: "officer_template",
      sort_order: 50,
      public_title: "Vice President",
      responsibility_label: "Clubs",
      max_active_seats: 1,
      permissions: [
        "manage_partner_clubs",
        "verify_participation",
        "process_points",
        "verify_submissions",
        "import_partner_clubs",
        "export_club_reports",
      ],
    },
    {
      id: IDS.csfRoleTreasurer,
      key: "treasurer",
      display_name: "Treasurer",
      description:
        "Dues verification, reasoned waivers, and dues reports. This role cannot decide applications.",
      role_type: "officer_template",
      sort_order: 60,
      public_title: "Treasurer",
      responsibility_label: "Dues",
      max_active_seats: 1,
      permissions: [
        "view_applications",
        "manage_payment_review",
        "export_dues_reports",
      ],
    },
    {
      id: IDS.csfRoleSecretary,
      key: "secretary",
      display_name: "Secretary",
      description:
        "Schedule, meetings, attendance, member directory, imports, and reports.",
      role_type: "officer_template",
      sort_order: 70,
      public_title: "Secretary",
      responsibility_label: "Meetings and records",
      max_active_seats: 1,
      permissions: [
        "manage_schedule",
        "manage_profiles",
        "manage_meetings",
        "reconcile_meeting_attendance",
        "import_members",
        "import_meetings",
        "export_membership_reports",
        "export_service_reports",
      ],
    },
    {
      id: IDS.csfRoleWebMaster,
      key: "web-master",
      display_name: "Web Master",
      description:
        "Activity and public-page content without private application or audit access.",
      role_type: "officer_template",
      sort_order: 80,
      public_title: "Web Master",
      responsibility_label: "Public content",
      max_active_seats: 1,
      permissions: ["manage_opportunities"],
    },
    {
      id: IDS.csfRoleActivityCoordinator,
      key: "activity-coordinator",
      display_name: "Activity Coordinator",
      description:
        "Create and edit activities and verify participation without final point processing.",
      role_type: "officer_template",
      sort_order: 90,
      public_title: "Activity Coordinator",
      responsibility_label: "Service activities",
      max_active_seats: 5,
      permissions: ["manage_opportunities", "verify_participation"],
    },
    {
      id: IDS.csfRoleDataManagement,
      key: "data-management",
      display_name: "Data Management",
      description:
        "Imports, reconciliation, profiles, point processing, reports, and domain-scoped history.",
      role_type: "officer_template",
      sort_order: 100,
      public_title: "Data Management",
      responsibility_label: "Records and imports",
      max_active_seats: 1,
      permissions: [
        "manage_profiles",
        "view_applications",
        "reconcile_meeting_attendance",
        "process_points",
        "verify_submissions",
        "import_applications",
        "import_members",
        "import_meetings",
        "import_partner_clubs",
        "export_membership_reports",
        "export_service_reports",
        "export_club_reports",
        "view_audit_history",
      ],
    },
    {
      id: IDS.csfRoleAdvisor,
      key: "advisor",
      display_name: "Adviser",
      description:
        "Adviser oversight, academic exceptions, sensitive exports, staff access, and semester close or reopen.",
      role_type: "officer_template",
      sort_order: 10,
      public_title: "Adviser",
      responsibility_label: "Chapter oversight",
      max_active_seats: 1,
      permissions: csfPermissionKeys,
    },
  ];

  await must(
    "csf-expanded-roles",
    pluginDb.from("csf_roles").upsert(
      seededRoles.map(({ permissions: _permissions, ...role }) => ({
        ...role,
        organization_id: IDS.csfOrg,
        is_system: true,
      })),
      { onConflict: "organization_id,key" },
    ),
  );

  await must(
    "csf-expanded-role-permissions",
    pluginDb.from("csf_role_permissions").upsert(
      seededRoles.flatMap((role) =>
        role.permissions.map((permission) => ({
          organization_id: IDS.csfOrg,
          role_id: role.id,
          permission_key: permission,
          enabled: true,
        })),
      ),
      { onConflict: "role_id,permission_key" },
    ),
  );

  await must(
    "csf-expanded-terms",
    pluginDb.from("csf_terms").upsert(
      [
        {
          id: IDS.csfTermF25,
          organization_id: IDS.csfOrg,
          code: "F25",
          label: "Fall 2025",
          school_year: "2025-2026",
          semester: "fall",
          starts_at: "2025-08-12",
          ends_at: "2025-12-19",
          is_current: false,
          lifecycle_status: "open",
          closed_at: null,
          closed_by: null,
          closure_policy_version: null,
          settings: {
            csfPointPolicy: { minimumTotalPoints: 7, maxDrivePoints: 2 },
          },
        },
        {
          id: IDS.csfTermS26,
          organization_id: IDS.csfOrg,
          code: "S26",
          label: "Spring 2026",
          school_year: "2025-2026",
          semester: "spring",
          starts_at: "2026-01-06",
          ends_at: "2026-05-29",
          is_current: true,
          lifecycle_status: "open",
          closed_at: null,
          closed_by: null,
          closure_policy_version: null,
          settings: {
            csfPointPolicy: { minimumTotalPoints: 7, maxDrivePoints: 2 },
          },
        },
      ],
      { onConflict: "organization_id,code" },
    ),
  );

  await must(
    "csf-term-policies",
    pluginDb.from("csf_term_policies").upsert(
      [IDS.csfTermF25, IDS.csfTermS26].map((termId) => ({
        organization_id: IDS.csfOrg,
        term_id: termId,
        policy_version: 1,
        total_points_required: 7,
        max_drive_points: 2,
        max_points_per_activity: 3,
        required_meetings: 0,
        allowed_absences: 1,
        allow_point_carryover: false,
        updated_by: users.csfOfficer.id,
      })),
      { onConflict: "organization_id,term_id" },
    ),
  );

  await must(
    "csf-expanded-cohorts",
    pluginDb.from("csf_cohorts").upsert(
      [
        {
          id: IDS.csfCohort2027,
          organization_id: IDS.csfOrg,
          graduation_year: 2027,
          label: "Class of 2027",
          status: "active",
        },
        {
          id: IDS.csfCohort2028,
          organization_id: IDS.csfOrg,
          graduation_year: 2028,
          label: "Class of 2028",
          status: "active",
        },
        {
          id: IDS.csfCohort2029,
          organization_id: IDS.csfOrg,
          graduation_year: 2029,
          label: "Class of 2029",
          status: "active",
        },
      ],
      { onConflict: "organization_id,graduation_year" },
    ),
  );

  await must(
    "csf-expanded-cohort-terms",
    pluginDb.from("csf_cohort_terms").upsert(
      [
        {
          organization_id: IDS.csfOrg,
          cohort_id: IDS.csfCohort2027,
          term_id: IDS.csfTermF25,
          grade_level: 11,
          sheet_tab_name: "F25-2027",
          status: "active",
        },
        {
          organization_id: IDS.csfOrg,
          cohort_id: IDS.csfCohort2027,
          term_id: IDS.csfTermS26,
          grade_level: 11,
          sheet_tab_name: "S26-2027",
          status: "active",
        },
        {
          organization_id: IDS.csfOrg,
          cohort_id: IDS.csfCohort2028,
          term_id: IDS.csfTermF25,
          grade_level: 10,
          sheet_tab_name: "F25-2028",
          status: "active",
        },
        {
          organization_id: IDS.csfOrg,
          cohort_id: IDS.csfCohort2029,
          term_id: IDS.csfTermS26,
          grade_level: 9,
          sheet_tab_name: "S26-2029",
          status: "active",
        },
      ],
      { onConflict: "cohort_id,term_id" },
    ),
  );

  await must(
    "csf-expanded-profiles",
    pluginDb.from("csf_profiles").upsert([
      {
        id: IDS.csfProfileOfficer,
        organization_id: IDS.csfOrg,
        first_name: "Priya",
        last_name: "Shah",
        preferred_name: "Priya",
        school_email: "priya.shah27@students.local.test",
        personal_email: "csf.officer@local.test",
        normalized_first_name: "priya",
        normalized_last_name: "shah",
        normalized_school_email: "priya.shah27@students.local.test",
        normalized_personal_email: "csf.officer@local.test",
        source_summary: { localFixture: true, role: "officer" },
      },
      {
        id: IDS.csfProfileComplete,
        organization_id: IDS.csfOrg,
        first_name: "Maya",
        last_name: "Patel",
        preferred_name: "Maya",
        school_email: "maya.patel28@students.local.test",
        personal_email: "maya.patel@example.test",
        normalized_first_name: "maya",
        normalized_last_name: "patel",
        normalized_school_email: "maya.patel28@students.local.test",
        normalized_personal_email: "maya.patel@example.test",
        source_summary: { localFixture: true, status: "requirements_complete" },
      },
      {
        id: IDS.csfProfilePending,
        organization_id: IDS.csfOrg,
        first_name: "Evan",
        last_name: "Chen",
        preferred_name: "Evan",
        school_email: "evan.chen28@students.local.test",
        personal_email: "evan.chen@example.test",
        normalized_first_name: "evan",
        normalized_last_name: "chen",
        normalized_school_email: "evan.chen28@students.local.test",
        normalized_personal_email: "evan.chen@example.test",
        source_summary: { localFixture: true, status: "pending_hours" },
      },
      {
        id: IDS.csfProfileMissingHours,
        organization_id: IDS.csfOrg,
        first_name: "Sofia",
        last_name: "Nguyen",
        preferred_name: "Sofia",
        school_email: "sofia.nguyen29@students.local.test",
        personal_email: "sofia.nguyen@example.test",
        normalized_first_name: "sofia",
        normalized_last_name: "nguyen",
        normalized_school_email: "sofia.nguyen29@students.local.test",
        normalized_personal_email: "sofia.nguyen@example.test",
        source_summary: { localFixture: true, status: "missing_hours" },
      },
      {
        id: IDS.csfProfileDuplicate,
        organization_id: IDS.csfOrg,
        first_name: "Maya",
        last_name: "Patel",
        preferred_name: "Maya P.",
        school_email: "maya.patel.alt@students.local.test",
        normalized_first_name: "maya",
        normalized_last_name: "patel",
        normalized_school_email: "maya.patel.alt@students.local.test",
        source_summary: { localFixture: true, status: "duplicate_review" },
      },
    ]),
  );

  await must(
    "csf-expanded-profile-memberships",
    pluginDb.from("csf_profile_cohort_memberships").upsert(
      [
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfileOfficer,
          cohort_id: IDS.csfCohort2027,
          status: "active",
        },
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfileComplete,
          cohort_id: IDS.csfCohort2028,
          status: "active",
        },
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfilePending,
          cohort_id: IDS.csfCohort2028,
          status: "active",
        },
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfileMissingHours,
          cohort_id: IDS.csfCohort2029,
          status: "active",
        },
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfileDuplicate,
          cohort_id: IDS.csfCohort2028,
          status: "active",
        },
      ],
      { onConflict: "profile_id,cohort_id" },
    ),
  );

  await must(
    "csf-expanded-profile-accounts",
    pluginDb.from("csf_profile_accounts").upsert(
      [
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfileOfficer,
          user_id: users.csfOfficer.id,
          status: "verified",
          is_primary: true,
          linked_by: users.developer.id,
        },
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfilePending,
          user_id: users.member.id,
          status: "pending",
          is_primary: false,
          linked_by: users.developer.id,
          notes: "Fixture pending account link for officer review.",
        },
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfilePending,
          user_id: users.csfApplicant.id,
          status: "verified",
          is_primary: true,
          linked_by: users.developer.id,
          notes: "Synthetic applicant account for role-based browser verification.",
        },
      ],
      { onConflict: "organization_id,profile_id,user_id" },
    ),
  );

  await must(
    "csf-expanded-staff",
    pluginDb.from("csf_staff_positions").upsert(
      [
        {
          id: IDS.csfStaffAdvisor,
          organization_id: IDS.csfOrg,
          user_id: users.csfAdviser.id,
          role_id: IDS.csfRoleAdvisor,
          school_year: "2025-2026",
          display_title: "Adviser",
          status: "active",
          appointed_by: users.developer.id,
          notes: "Synthetic adviser actor for local role-boundary tests.",
        },
        {
          id: IDS.csfStaffCoPresidentOne,
          organization_id: IDS.csfOrg,
          user_id: users.csfCoPresidentOne.id,
          role_id: IDS.csfRoleCoPresident,
          school_year: "2025-2026",
          display_title: "Co-President",
          status: "active",
          appointed_by: users.developer.id,
          notes: "Synthetic first Co-President seat.",
        },
        {
          id: IDS.csfStaffCoPresidentTwo,
          organization_id: IDS.csfOrg,
          user_id: users.csfCoPresidentTwo.id,
          role_id: IDS.csfRoleCoPresident,
          school_year: "2025-2026",
          display_title: "Co-President",
          status: "active",
          appointed_by: users.developer.id,
          notes: "Synthetic second Co-President seat.",
        },
        {
          id: IDS.csfStaffVicePresidentMembership,
          organization_id: IDS.csfOrg,
          user_id: users.csfVpMembership.id,
          role_id: IDS.csfRoleVicePresidentMembership,
          school_year: "2025-2026",
          display_title: "Vice President — Membership",
          status: "active",
          appointed_by: users.developer.id,
          notes: "Synthetic membership operations actor.",
        },
        {
          id: IDS.csfStaffVicePresidentPublicity,
          organization_id: IDS.csfOrg,
          user_id: users.csfVpPublicity.id,
          role_id: IDS.csfRoleVicePresidentPublicity,
          school_year: "2025-2026",
          display_title: "Vice President — Publicity",
          status: "active",
          appointed_by: users.developer.id,
          notes: "Synthetic publicity operations actor.",
        },
        {
          id: IDS.csfStaffVicePresidentClubs,
          organization_id: IDS.csfOrg,
          user_id: users.csfVpClubs.id,
          role_id: IDS.csfRoleVicePresidentClubs,
          school_year: "2025-2026",
          display_title: "Vice President — Clubs",
          status: "active",
          appointed_by: users.developer.id,
          notes: "Synthetic partner-club operations actor.",
        },
        {
          id: IDS.csfStaffTreasurer,
          organization_id: IDS.csfOrg,
          user_id: users.csfTreasurer.id,
          role_id: IDS.csfRoleTreasurer,
          school_year: "2025-2026",
          display_title: "Treasurer",
          status: "active",
          appointed_by: users.developer.id,
          notes: "Synthetic dues-only application actor.",
        },
        {
          id: IDS.csfStaffSecretary,
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfileComplete,
          user_id: users.csfSecretary.id,
          role_id: IDS.csfRoleSecretary,
          school_year: "2025-2026",
          display_title: "Secretary",
          status: "active",
          appointed_by: users.developer.id,
          notes: "Maintains class workbooks and meeting attendance.",
        },
        {
          id: IDS.csfStaffWebMaster,
          organization_id: IDS.csfOrg,
          user_id: users.csfWebMaster.id,
          role_id: IDS.csfRoleWebMaster,
          school_year: "2025-2026",
          display_title: "Web Master",
          status: "active",
          appointed_by: users.developer.id,
          notes: "Synthetic public-content actor.",
        },
        {
          id: IDS.csfStaffPosition,
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfileOfficer,
          user_id: users.csfOfficer.id,
          role_id: IDS.csfRoleActivityCoordinator,
          school_year: "2025-2026",
          display_title: "Activity Coordinator",
          status: "active",
          appointed_by: users.developer.id,
          notes: "Owns event rosters and point verification.",
        },
        {
          id: IDS.csfStaffActivityCoordinatorTwo,
          organization_id: IDS.csfOrg,
          user_id: users.csfActivityCoordinatorTwo.id,
          role_id: IDS.csfRoleActivityCoordinator,
          school_year: "2025-2026",
          display_title: "Activity Coordinator",
          status: "active",
          appointed_by: users.developer.id,
          notes: "Synthetic second Activity Coordinator seat.",
        },
        {
          id: IDS.csfStaffActivityCoordinatorThree,
          organization_id: IDS.csfOrg,
          user_id: users.csfActivityCoordinatorThree.id,
          role_id: IDS.csfRoleActivityCoordinator,
          school_year: "2025-2026",
          display_title: "Activity Coordinator",
          status: "active",
          appointed_by: users.developer.id,
          notes: "Synthetic third Activity Coordinator seat.",
        },
        {
          id: IDS.csfStaffActivityCoordinatorFour,
          organization_id: IDS.csfOrg,
          user_id: users.csfActivityCoordinatorFour.id,
          role_id: IDS.csfRoleActivityCoordinator,
          school_year: "2025-2026",
          display_title: "Activity Coordinator",
          status: "active",
          appointed_by: users.developer.id,
          notes: "Synthetic fourth Activity Coordinator seat.",
        },
        {
          id: IDS.csfStaffActivityCoordinatorFive,
          organization_id: IDS.csfOrg,
          user_id: users.csfActivityCoordinatorFive.id,
          role_id: IDS.csfRoleActivityCoordinator,
          school_year: "2025-2026",
          display_title: "Activity Coordinator",
          status: "active",
          appointed_by: users.developer.id,
          notes: "Synthetic fifth Activity Coordinator seat.",
        },
        {
          id: IDS.csfStaffDataManagement,
          organization_id: IDS.csfOrg,
          user_id: users.csfDataManagement.id,
          role_id: IDS.csfRoleDataManagement,
          school_year: "2025-2026",
          display_title: "Data Management",
          status: "active",
          appointed_by: users.developer.id,
          notes: "Synthetic records and imports actor.",
        },
      ],
      { onConflict: "id" },
    ),
  );

  const seededApplications = await must(
    "csf-expanded-applications",
    pluginDb
      .from("csf_term_applications")
      .upsert(
        [
          {
            organization_id: IDS.csfOrg,
            profile_id: IDS.csfProfileMember,
            cohort_id: IDS.csfCohort2028,
            term_id: IDS.csfTermS26,
            source: "google_form_sheet",
            status: "accepted",
            current_grade_level: 10,
            returning_status: "returning",
            shirt_size: "returning_member",
            most_checked_email: "student.2028@local.test",
            list_i_points: 5,
            list_i_ii_points: 3,
            grand_total_points: 8,
            social_confirmation: true,
            submitted_at: "2026-01-10T19:30:00-08:00",
            reviewed_by: users.csfOfficer.id,
            reviewed_at: "2026-01-12T16:30:00-08:00",
            review_notes: "Accepted from Spring Google Form import.",
            application_data: { payment: "confirmed", sourceSheet: "S26" },
          },
          {
            organization_id: IDS.csfOrg,
            profile_id: IDS.csfProfileComplete,
            cohort_id: IDS.csfCohort2028,
            term_id: IDS.csfTermS26,
            source: "google_form_sheet",
            status: "accepted",
            current_grade_level: 10,
            returning_status: "new",
            shirt_size: "M",
            most_checked_email: "maya.patel@example.test",
            list_i_points: 6,
            list_i_ii_points: 2,
            grand_total_points: 8,
            social_confirmation: true,
            submitted_at: "2026-01-11T18:05:00-08:00",
            reviewed_by: users.csfOfficer.id,
            reviewed_at: "2026-01-13T15:45:00-08:00",
            review_notes: "Transcript and payment verified.",
            application_data: { payment: "confirmed", transcript: "verified" },
          },
          {
            organization_id: IDS.csfOrg,
            profile_id: IDS.csfProfilePending,
            cohort_id: IDS.csfCohort2028,
            term_id: IDS.csfTermS26,
            source: "sheet",
            status: "needs_review",
            current_grade_level: 10,
            returning_status: "returning",
            shirt_size: "returning_member",
            most_checked_email: "evan.chen@example.test",
            list_i_points: 4,
            list_i_ii_points: 1,
            grand_total_points: 5,
            submitted_at: "2026-01-12T20:40:00-08:00",
            review_notes: "Missing one List I course row.",
            application_data: { issue: "course_points_low" },
          },
          {
            organization_id: IDS.csfOrg,
            profile_id: IDS.csfProfileMissingHours,
            cohort_id: IDS.csfCohort2029,
            term_id: IDS.csfTermS26,
            source: "google_form_sheet",
            status: "needs_action",
            current_grade_level: 9,
            returning_status: "new",
            shirt_size: "S",
            most_checked_email: "sofia.nguyen@example.test",
            list_i_points: 7,
            list_i_ii_points: 0,
            grand_total_points: 7,
            submitted_at: "2026-01-15T21:10:00-08:00",
            review_notes: "Needs student profile link and point plan.",
            application_data: { needsProfileLink: true },
          },
        ],
        { onConflict: "profile_id,term_id" },
      )
      .select("id, profile_id, cohort_id, term_id, status, reviewed_at"),
  );

  await must(
    "csf-term-memberships",
    pluginDb.from("csf_term_memberships").upsert(
      seededApplications
        .filter((application) => application.status === "accepted")
        .map((application) => ({
          organization_id: IDS.csfOrg,
          profile_id: application.profile_id,
          cohort_id: application.cohort_id,
          term_id: application.term_id,
          application_id: application.id,
          status:
            application.profile_id === IDS.csfProfileMember
              ? "active"
              : "accepted",
          accepted_at: application.reviewed_at,
          activated_at:
            application.profile_id === IDS.csfProfileMember
              ? application.reviewed_at
              : null,
          status_reason: "Seeded from an accepted CSF application.",
        })),
      { onConflict: "organization_id,profile_id,term_id" },
    ),
  );

  const seededMeetings = await must(
    "csf-expanded-meetings",
    pluginDb
      .from("csf_term_meetings")
      .upsert(
        [
          {
            id: IDS.csfMeetingGeneral,
            organization_id: IDS.csfOrg,
            term_id: IDS.csfTermS26,
            meeting_key: "spring_general_meeting",
            label: "Spring General Meeting",
            meeting_date: "2026-02-03",
            starts_at: "2026-02-03T15:45:00-08:00",
            location: "DVHS Library",
            attendance_source_url:
              "https://docs.google.com/spreadsheets/d/local-csf-meeting-general",
            required: true,
            sort_order: 10,
            status: "active",
            settings: { expectedRows: 180 },
            created_by: users.csfOfficer.id,
          },
          {
            id: IDS.csfMeetingService,
            organization_id: IDS.csfOrg,
            term_id: IDS.csfTermS26,
            meeting_key: "service_check_in",
            label: "Service Check-in",
            meeting_date: "2026-03-10",
            starts_at: "2026-03-10T15:45:00-07:00",
            location: "DVHS Commons",
            attendance_source_url:
              "https://docs.google.com/spreadsheets/d/local-csf-meeting-service",
            required: true,
            sort_order: 20,
            status: "active",
            settings: { expectedRows: 160 },
            created_by: users.csfOfficer.id,
          },
        ],
        { onConflict: "organization_id,term_id,meeting_key" },
      )
      .select(
        "id, organization_id, term_id, meeting_key, label, meeting_date, starts_at, location, attendance_source_url, required, sort_order, status, settings, created_by",
      ),
  );

  const meetingProjectionByLegacyId = new Map();
  for (const meeting of seededMeetings) {
    const logicalMeeting = await must(
      `csf-logical-meeting-${meeting.meeting_key}`,
      pluginDb
        .from("csf_meetings")
        .upsert(
          {
            organization_id: meeting.organization_id,
            term_id: meeting.term_id,
            meeting_key: meeting.meeting_key,
            label: meeting.label,
            required: meeting.required,
            sort_order: meeting.sort_order,
            status: meeting.status,
            created_by: meeting.created_by,
          },
          { onConflict: "organization_id,term_id,meeting_key" },
        )
        .select("id")
        .single(),
    );
    const meetingSession = await must(
      `csf-meeting-session-${meeting.meeting_key}`,
      pluginDb
        .from("csf_meeting_sessions")
        .upsert(
          {
            organization_id: meeting.organization_id,
            meeting_id: logicalMeeting.id,
            legacy_term_meeting_id: meeting.id,
            session_date: meeting.meeting_date,
            starts_at: meeting.starts_at,
            location: meeting.location,
            attendance_source_url: meeting.attendance_source_url,
            status: "scheduled",
            settings: meeting.settings,
            created_by: meeting.created_by,
          },
          { onConflict: "legacy_term_meeting_id" },
        )
        .select("id, meeting_id")
        .single(),
    );
    meetingProjectionByLegacyId.set(meeting.id, meetingSession);
  }

  await must(
    "csf-expanded-opportunities",
    pluginDb.from("csf_opportunities").upsert([
      {
        id: IDS.csfOpportunityFoodBank,
        organization_id: IDS.csfOrg,
        term_id: IDS.csfTermS26,
        title: "Contra Costa Food Bank Sorting",
        body: "<p>Sort pantry items and assemble grocery boxes for weekend distribution. Wear closed-toe shoes and bring your CSF ID.</p>",
        starts_at: "2026-03-21T09:00:00-07:00",
        ends_at: "2026-03-21T12:00:00-07:00",
        location: "Contra Costa Food Bank Warehouse",
        signup_url:
          "https://docs.google.com/spreadsheets/d/local-food-bank-signup/edit",
        contact_email: "csf-operations@local.test",
        point_value: 3,
        point_type: "non_drive",
        signup_mode: "external",
        requires_point_submission: true,
        evidence_policy: "optional",
        source_organization: "Contra Costa Food Bank",
        created_by_user_id: users.csfOfficer.id,
        status: "published",
        external_sheet_url:
          "https://docs.google.com/spreadsheets/d/local-food-bank-signup/edit",
        sheet_export_status: "exported",
        sheet_export_row_id: "FoodBank!A42",
        published_at: "2026-03-02T12:00:00-08:00",
      },
      {
        id: IDS.csfOpportunityCleanup,
        organization_id: IDS.csfOrg,
        term_id: IDS.csfTermS26,
        title: "DVHS Campus Cleanup",
        body: "<p>Officer-led campus cleanup after school. Gloves and bags will be provided at the Commons.</p>",
        starts_at: "2026-08-28T15:45:00-07:00",
        ends_at: "2026-08-28T17:15:00-07:00",
        location: "DVHS Commons",
        signup_url:
          "https://docs.google.com/spreadsheets/d/local-campus-cleanup/edit",
        contact_email: "csf-operations@local.test",
        point_value: 1.5,
        point_type: "non_drive",
        signup_mode: "external",
        requires_point_submission: false,
        evidence_policy: "none",
        source_organization: "DVHS CSF",
        created_by_user_id: users.csfOfficer.id,
        status: "published",
        external_sheet_url:
          "https://docs.google.com/spreadsheets/d/local-campus-cleanup/edit",
        sheet_export_status: "pending",
        published_at: "2026-07-01T12:00:00-07:00",
      },
      {
        id: IDS.csfOpportunityTutoring,
        organization_id: IDS.csfOrg,
        term_id: IDS.csfTermS26,
        title: "Library Peer Tutoring",
        body: "<p>Support Algebra II and chemistry tutoring tables in the library. Members can claim one non-drive point per verified session.</p>",
        starts_at: "2026-09-02T15:30:00-07:00",
        ends_at: "2026-09-02T16:30:00-07:00",
        location: "DVHS Library",
        signup_url:
          "https://docs.google.com/spreadsheets/d/local-library-tutoring/edit",
        contact_email: "dvhs.library@example.test",
        point_value: 1,
        point_type: "non_drive",
        signup_mode: "external",
        requires_point_submission: true,
        evidence_policy: "required",
        source_organization: "DVHS Library",
        created_by_user_id: users.csfOfficer.id,
        status: "published",
        external_sheet_url:
          "https://docs.google.com/spreadsheets/d/local-library-tutoring/edit",
        sheet_export_status: "not_exported",
        published_at: "2026-07-03T09:00:00-07:00",
      },
      {
        id: IDS.csfOpportunityDrive,
        organization_id: IDS.csfOrg,
        term_id: IDS.csfTermS26,
        title: "Hygiene Kit Drive",
        body: "<p>Bring approved hygiene-kit supplies for a local shelter partner. Drive points are capped by CSF policy.</p>",
        starts_at: "2026-09-14T08:00:00-07:00",
        ends_at: "2026-09-18T15:30:00-07:00",
        location: "DVHS Front Office",
        contact_email: "csf-operations@local.test",
        point_value: 2,
        point_type: "drive",
        signup_mode: "none",
        requires_point_submission: true,
        evidence_policy: "required",
        source_organization: "DVHS CSF",
        created_by_user_id: users.csfOfficer.id,
        status: "published",
        sheet_export_status: "not_exported",
        published_at: "2026-07-01T11:00:00-07:00",
      },
    ]),
  );

  await must(
    "csf-expanded-signups",
    pluginDb.from("csf_opportunity_signups").upsert(
      [
        {
          id: "10000000-0000-4000-8000-000000000201",
          organization_id: IDS.csfOrg,
          opportunity_id: IDS.csfOpportunityFoodBank,
          profile_id: IDS.csfProfileComplete,
          term_id: IDS.csfTermS26,
          source: "external_sheet",
          signup_status: "credited",
          attendance_status: "verified",
          signup_name: "Maya Patel",
          signup_email: "maya.patel28@students.local.test",
          external_row_id: "FoodBank!12",
          signed_up_at: "2026-03-04T18:32:00-08:00",
          attendance_verified_by: users.csfOfficer.id,
          attendance_verified_at: "2026-03-21T13:20:00-07:00",
          points_expected: 3,
          metadata: { slot: "9am sorting", localFixture: true },
        },
        {
          id: "10000000-0000-4000-8000-000000000202",
          organization_id: IDS.csfOrg,
          opportunity_id: IDS.csfOpportunityFoodBank,
          profile_id: IDS.csfProfilePending,
          term_id: IDS.csfTermS26,
          source: "external_sheet",
          signup_status: "signed_up",
          attendance_status: "unknown",
          signup_name: "Evan Chen",
          signup_email: "evan.chen28@students.local.test",
          external_row_id: "FoodBank!18",
          signed_up_at: "2026-03-05T16:12:00-08:00",
          points_expected: 3,
          metadata: { slot: "9am sorting", localFixture: true },
        },
        {
          id: "10000000-0000-4000-8000-000000000203",
          organization_id: IDS.csfOrg,
          opportunity_id: IDS.csfOpportunityCleanup,
          profile_id: IDS.csfProfileMissingHours,
          term_id: IDS.csfTermS26,
          source: "external_sheet",
          signup_status: "waitlisted",
          attendance_status: "unknown",
          signup_name: "Sofia Nguyen",
          signup_email: "sofia.nguyen29@students.local.test",
          external_row_id: "Cleanup!27",
          signed_up_at: "2026-07-04T20:05:00-07:00",
          points_expected: 1.5,
          metadata: { waitlistPosition: 3, localFixture: true },
        },
      ],
      { onConflict: "organization_id,opportunity_id,profile_id" },
    ),
  );

  await must(
    "csf-expanded-submissions",
    pluginDb.from("csf_point_submissions").upsert([
      {
        id: "10000000-0000-4000-8000-000000000220",
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfileMember,
        term_id: IDS.csfTermS26,
        opportunity_id: IDS.csfOpportunity,
        source: "student",
        description: "Quail Run Suessical Musical",
        claimed_points: 2,
        point_type: "non_drive",
        activity_date: "2026-05-08",
        status: "approved",
        submitted_by: users.csfMember.id,
        submitted_at: "2026-05-08T19:15:00-07:00",
        reviewed_by: users.csfOfficer.id,
        reviewed_at: "2026-05-08T19:20:00-07:00",
        review_notes: "Verified from the partner activity roster.",
      },
      {
        id: "10000000-0000-4000-8000-000000000204",
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfilePending,
        term_id: IDS.csfTermS26,
        opportunity_id: IDS.csfOpportunityFoodBank,
        source: "student",
        description: "Food bank sorting shift",
        claimed_points: 3,
        point_type: "non_drive",
        status: "submitted",
        submitted_by: users.csfApplicant.id,
        submitted_at: "2026-03-21T20:10:00-07:00",
      },
      {
        id: "10000000-0000-4000-8000-000000000205",
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfileMissingHours,
        term_id: IDS.csfTermS26,
        opportunity_id: IDS.csfOpportunityDrive,
        source: "student",
        description: "Hygiene kit donation receipt",
        claimed_points: 2,
        point_type: "drive",
        status: "needs_action",
        submitted_at: "2026-04-09T19:45:00-07:00",
        review_notes: "Photo evidence is missing item count.",
      },
      {
        id: "10000000-0000-4000-8000-000000000206",
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfileComplete,
        term_id: IDS.csfTermS26,
        opportunity_id: IDS.csfOpportunityFoodBank,
        source: "student",
        description: "Food bank sorting verified by officer roster",
        claimed_points: 3,
        point_type: "non_drive",
        status: "approved",
        submitted_at: "2026-03-21T12:35:00-07:00",
        reviewed_by: users.csfOfficer.id,
        reviewed_at: "2026-03-21T13:25:00-07:00",
        review_notes: "Matched attendance sheet.",
      },
    ]),
  );

  await must(
    "csf-expanded-credit-records",
    pluginDb.from("csf_credit_records").upsert([
      {
        id: "10000000-0000-4000-8000-000000000207",
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfileComplete,
        term_id: IDS.csfTermS26,
        submission_id: "10000000-0000-4000-8000-000000000206",
        opportunity_id: IDS.csfOpportunityFoodBank,
        source: "submission",
        points: 3,
        point_type: "non_drive",
        status: "verified",
        verified_by: users.csfOfficer.id,
        verified_at: "2026-03-21T13:25:00-07:00",
        evidence: { rosterRow: "FoodBank!12" },
      },
      {
        id: "10000000-0000-4000-8000-000000000208",
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfileComplete,
        term_id: IDS.csfTermS26,
        source: "manual",
        points: 2,
        point_type: "drive",
        status: "verified",
        verified_by: users.csfOfficer.id,
        verified_at: "2026-04-12T16:20:00-07:00",
        evidence: { drive: "Hygiene Kit Drive" },
      },
      {
        id: "10000000-0000-4000-8000-000000000209",
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfilePending,
        term_id: IDS.csfTermS26,
        submission_id: "10000000-0000-4000-8000-000000000204",
        opportunity_id: IDS.csfOpportunityFoodBank,
        source: "submission",
        points: 3,
        point_type: "non_drive",
        status: "pending",
        evidence: { rosterRow: "FoodBank!18" },
      },
      {
        id: "10000000-0000-4000-8000-000000000210",
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfileMember,
        term_id: IDS.csfTermS26,
        submission_id: "10000000-0000-4000-8000-000000000220",
        opportunity_id: IDS.csfOpportunity,
        source: "manual",
        points: 2,
        point_type: "non_drive",
        status: "verified",
        verified_by: users.csfOfficer.id,
        verified_at: "2026-05-08T19:20:00-07:00",
        evidence: { localFixture: true },
      },
    ]),
  );

  await must(
    "csf-expanded-meeting-attendance",
    pluginDb.from("csf_meeting_attendance").upsert(
      [
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfileMember,
          term_id: IDS.csfTermS26,
          term_meeting_id: IDS.csfMeetingGeneral,
          meeting_id: meetingProjectionByLegacyId.get(IDS.csfMeetingGeneral)
            ?.meeting_id,
          meeting_session_id: meetingProjectionByLegacyId.get(
            IDS.csfMeetingGeneral,
          )?.id,
          meeting_key: "spring_general_meeting",
          meeting_label: "Spring General Meeting",
          status: "attended",
          source: "sheet",
          submitted_name: "Aarav Mehta",
          submitted_email: "aarav.mehta28@students.local.test",
          match_status: "confirmed",
          match_confidence: 1,
          match_details: { matchBasis: "email" },
          source_submitted_at: "2026-02-03T15:51:00-08:00",
          recorded_by: users.csfOfficer.id,
        },
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfileComplete,
          term_id: IDS.csfTermS26,
          term_meeting_id: IDS.csfMeetingGeneral,
          meeting_id: meetingProjectionByLegacyId.get(IDS.csfMeetingGeneral)
            ?.meeting_id,
          meeting_session_id: meetingProjectionByLegacyId.get(
            IDS.csfMeetingGeneral,
          )?.id,
          meeting_key: "spring_general_meeting",
          meeting_label: "Spring General Meeting",
          status: "attended",
          source: "sheet",
          submitted_name: "Maya Patel",
          submitted_email: "maya.patel28@students.local.test",
          match_status: "confirmed",
          match_confidence: 1,
          match_details: { matchBasis: "email" },
          source_submitted_at: "2026-02-03T15:52:00-08:00",
          recorded_by: users.csfOfficer.id,
        },
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfileMissingHours,
          term_id: IDS.csfTermS26,
          term_meeting_id: IDS.csfMeetingService,
          meeting_id: meetingProjectionByLegacyId.get(IDS.csfMeetingService)
            ?.meeting_id,
          meeting_session_id: meetingProjectionByLegacyId.get(
            IDS.csfMeetingService,
          )?.id,
          meeting_key: "service_check_in",
          meeting_label: "Service Check-in",
          status: "missed",
          source: "sheet",
          submitted_name: "Sofia Nguyen",
          submitted_email: "sofia.nguyen29@students.local.test",
          match_status: "confirmed",
          match_confidence: 1,
          match_details: { matchBasis: "email" },
          recorded_by: users.csfOfficer.id,
        },
      ],
      { onConflict: "profile_id,term_id,meeting_key" },
    ),
  );

  await must(
    "csf-expanded-activity-events",
    pluginDb.from("csf_profile_activity_events").upsert([
      {
        id: "10000000-0000-4000-8000-000000000211",
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfileComplete,
        term_id: IDS.csfTermS26,
        opportunity_id: IDS.csfOpportunityFoodBank,
        credit_record_id: "10000000-0000-4000-8000-000000000207",
        event_type: "opportunity",
        title: "Contra Costa Food Bank Sorting",
        description: "Verified from imported sign-up roster.",
        event_at: "2026-03-21T12:00:00-07:00",
        point_type: "non_drive",
        raw_points: 3,
        counted_points: 3,
        status: "verified",
        source: "submission",
        source_ref: { signupId: "10000000-0000-4000-8000-000000000201" },
      },
      {
        id: "10000000-0000-4000-8000-000000000212",
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfileComplete,
        term_id: IDS.csfTermS26,
        credit_record_id: "10000000-0000-4000-8000-000000000208",
        event_type: "opportunity",
        title: "Hygiene Kit Drive",
        description: "Drive credit capped by CSF policy.",
        event_at: "2026-04-12T15:30:00-07:00",
        point_type: "drive",
        raw_points: 2,
        counted_points: 2,
        status: "verified",
        source: "manual",
        source_ref: { driveCapApplied: true },
      },
      {
        id: "10000000-0000-4000-8000-000000000213",
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfilePending,
        term_id: IDS.csfTermS26,
        opportunity_id: IDS.csfOpportunityFoodBank,
        credit_record_id: "10000000-0000-4000-8000-000000000209",
        event_type: "opportunity",
        title: "Food Bank Sorting Pending",
        description: "Waiting for officer approval.",
        event_at: "2026-03-21T12:00:00-07:00",
        point_type: "non_drive",
        raw_points: 3,
        counted_points: 0,
        status: "pending",
        source: "submission",
        source_ref: { submissionId: "10000000-0000-4000-8000-000000000204" },
      },
    ]),
  );

  await must(
    "csf-expanded-partner-clubs",
    pluginDb.from("csf_partner_clubs").upsert(
      [
        {
          id: IDS.csfPartnerLibrary,
          organization_id: IDS.csfOrg,
          name: "DVHS Library",
          club_type: "school_department",
          contact_name: "Ms. Hernandez",
          contact_email: "dvhs.library@example.test",
          president_name: "Priya Shah",
          advisor_name: "Ms. Hernandez",
          recruiting_new_members: true,
          public_description:
            "Library support, tutoring, shelving, and literacy events approved for CSF non-drive credit.",
          communication_method: "Email and shared Google Sheet",
          approved_point_types: ["non_drive"],
          notes: "Use weekly tutoring roster for verification.",
          status: "active",
          created_by: users.csfOfficer.id,
        },
      ],
      { onConflict: "organization_id,name" },
    ),
  );

  await must(
    "csf-partner-club-aliases",
    pluginDb.from("csf_partner_club_aliases").upsert(
      [
        {
          organization_id: IDS.csfOrg,
          partner_club_id: IDS.csfPartnerClub,
          alias: "Quail Run Elementary School",
          normalized_alias: "quail run elementary school",
          source: "legacy_import",
          first_seen_term_id: IDS.csfTermS26,
          last_seen_term_id: IDS.csfTermS26,
          created_by: users.csfOfficer.id,
        },
        {
          organization_id: IDS.csfOrg,
          partner_club_id: IDS.csfPartnerLibrary,
          alias: "DVHS Library",
          normalized_alias: "dvhs library",
          source: "staff",
          first_seen_term_id: IDS.csfTermS26,
          last_seen_term_id: IDS.csfTermS26,
          created_by: users.csfOfficer.id,
        },
      ],
      { onConflict: "organization_id,normalized_alias" },
    ),
  );

  await must(
    "csf-expanded-partner-batch",
    pluginDb.from("csf_partner_submission_batches").upsert({
      id: IDS.csfPartnerBatch,
      organization_id: IDS.csfOrg,
      partner_club_id: IDS.csfPartnerLibrary,
      term_id: IDS.csfTermS26,
      title: "March Library Tutoring Roster",
      source: "sheet",
      source_url:
        "https://docs.google.com/spreadsheets/d/local-library-tutoring/edit",
      status: "needs_verification",
      submitted_by: users.csfOfficer.id,
      summary: { rows: 14, matched: 11, ambiguous: 2, rejected: 1 },
    }),
  );

  await must(
    "csf-partner-club-terms",
    pluginDb.from("csf_partner_club_terms").upsert(
      [
        {
          organization_id: IDS.csfOrg,
          partner_club_id: IDS.csfPartnerClub,
          term_id: IDS.csfTermS26,
          relationship_status: "returning",
          workflow_status: "active",
          approved_point_types: ["non_drive"],
          non_drive_points: 3,
          drive_points: 0,
          policy_notes:
            "Imported participant sheets are reviewed by a CSF officer.",
          reviewed_by: users.csfOfficer.id,
          reviewed_at: "2026-01-20T12:00:00-08:00",
        },
        {
          organization_id: IDS.csfOrg,
          partner_club_id: IDS.csfPartnerLibrary,
          term_id: IDS.csfTermS26,
          relationship_status: "new",
          workflow_status: "active",
          approved_point_types: ["non_drive"],
          non_drive_points: 3,
          drive_points: 0,
          source_batch_id: IDS.csfPartnerBatch,
          policy_notes: "Use the weekly tutoring roster for verification.",
          reviewed_by: users.csfOfficer.id,
          reviewed_at: "2026-03-01T12:00:00-08:00",
        },
      ],
      { onConflict: "organization_id,partner_club_id,term_id" },
    ),
  );

  await must(
    "csf-expanded-sheet-jobs",
    pluginDb.rpc("csf_seed_synthetic_import_fixture", {
      p_organization_id: IDS.csfOrg,
      p_jobs: [
      {
        id: IDS.csfSheetJobPreview,
        sourceId: IDS.csfSheetSource,
        initiatedBy: users.csfOfficer.id,
        mode: "preview",
        status: "completed",
        sourceType: "student_roster",
        mappingVersion: 1,
        summary: {
          rows: 6,
          uniqueProfiles: 5,
          matched: 3,
          newProfiles: 1,
          ambiguous: 1,
          rowsWithWarnings: 1,
          activityCount: 9,
          requirementsMet: 3,
        },
        startedAt: "2026-03-18T18:09:00-07:00",
        completedAt: "2026-03-18T18:10:00-07:00",
      },
      {
        id: IDS.csfSheetJobCommit,
        sourceId: IDS.csfSheetSource,
        previewJobId: IDS.csfSheetJobPreview,
        initiatedBy: users.csfOfficer.id,
        mode: "commit",
        status: "completed",
        sourceType: "student_roster",
        mappingVersion: 1,
        summary: {
          previewJobId: IDS.csfSheetJobPreview,
          committed: 4,
          ambiguous: 1,
          failed: 1,
        },
        startedAt: "2026-03-18T18:11:00-07:00",
        completedAt: "2026-03-18T18:12:00-07:00",
      },
    ],
    }),
  );

  await must(
    "csf-expanded-sheet-rows",
    pluginDb.rpc("csf_seed_synthetic_import_fixture", {
      p_organization_id: IDS.csfOrg,
      p_rows: [
      {
        id: "10000000-0000-4000-8000-000000000214",
        jobId: IDS.csfSheetJobPreview,
        sourceId: IDS.csfSheetSource,
        cohortId: IDS.csfCohort2028,
        termId: IDS.csfTermS26,
        sheetTabName: "S26",
        rowNumber: 12,
        sourceRange: "'S26'!A1:Z1000",
        rawData: {
          First: "Maya",
          Last: "Patel",
          "SRVUSD Email": "maya.patel28@students.local.test",
          "All Reqs Met?": "TRUE",
        },
        normalizedData: {
          firstName: "Maya",
          lastName: "Patel",
          matchBasis: "email",
          schoolEmail: "maya.patel28@students.local.test",
        },
        rowHash: "local-maya-patel-row",
        matchedProfileId: IDS.csfProfileComplete,
        importStatus: "updated",
        warnings: [],
        errors: [],
      },
      {
        id: "10000000-0000-4000-8000-000000000215",
        jobId: IDS.csfSheetJobPreview,
        sourceId: IDS.csfSheetSource,
        cohortId: IDS.csfCohort2028,
        termId: IDS.csfTermS26,
        sheetTabName: "S26",
        rowNumber: 18,
        sourceRange: "'S26'!A1:Z1000",
        rawData: {
          First: "Maya",
          Last: "Patel",
          "SRVUSD Email": "",
          "All Reqs Met?": "TRUE",
        },
        normalizedData: {
          firstName: "Maya",
          lastName: "Patel",
          matchBasis: "name",
        },
        rowHash: "local-maya-patel-ambiguous-row",
        matchedProfileId: null,
        importStatus: "ambiguous",
        warnings: ["Two CSF profiles share this normalized name."],
        errors: [],
      },
      {
        id: "10000000-0000-4000-8000-000000000216",
        jobId: IDS.csfSheetJobPreview,
        sourceId: IDS.csfSheetSource,
        cohortId: IDS.csfCohort2029,
        termId: IDS.csfTermS26,
        sheetTabName: "S26",
        rowNumber: 24,
        sourceRange: "'S26'!A1:Z1000",
        rawData: {
          First: "Sofia",
          Last: "",
          "SRVUSD Email": "sofia.nguyen29@students.local.test",
        },
        normalizedData: {
          firstName: "Sofia",
          lastName: "",
          matchBasis: "email",
          schoolEmail: "sofia.nguyen29@students.local.test",
        },
        rowHash: "local-sofia-incomplete-row",
        matchedProfileId: IDS.csfProfileMissingHours,
        importStatus: "error",
        warnings: ["Row has an incomplete name."],
        errors: ["Row has an incomplete name."],
      },
    ],
    }),
  );

  await must(
    "csf-expanded-sheet-logs",
    pluginDb.from("csf_sheet_sync_logs").upsert([
      {
        id: "10000000-0000-4000-8000-000000000217",
        organization_id: IDS.csfOrg,
        source_id: IDS.csfSheetSource,
        job_id: IDS.csfSheetJobPreview,
        level: "warning",
        message: "Preview completed with rows needing officer review",
        details: { ambiguous: 1, warnings: 1, source: "S26" },
        created_by: users.csfOfficer.id,
        created_at: "2026-03-18T18:10:00-07:00",
      },
      {
        id: "10000000-0000-4000-8000-000000000218",
        organization_id: IDS.csfOrg,
        source_id: IDS.csfSheetSource,
        job_id: IDS.csfSheetJobCommit,
        level: "info",
        message: "Commit completed",
        details: { committed: 4, ambiguous: 1, failed: 1 },
        created_by: users.csfOfficer.id,
        created_at: "2026-03-17T17:30:00-07:00",
      },
    ]),
  );

  await must(
    "csf-expanded-announcements",
    pluginDb.from("csf_announcements").upsert([
      {
        id: IDS.csfAnnouncementPinned,
        organization_id: IDS.csfOrg,
        term_id: IDS.csfTermS26,
        title: "Spring service hours checkpoint",
        body: "Members should have at least 4 verified points by April 15. Check your CSF profile and submit missing evidence before the deadline.",
        audience: "members",
        status: "published",
        pinned: true,
        published_at: "2026-03-25T12:00:00-07:00",
        expires_at: "2026-04-16T00:00:00-07:00",
        created_by: users.csfOfficer.id,
      },
      {
        id: IDS.csfAnnouncementOfficer,
        organization_id: IDS.csfOrg,
        term_id: IDS.csfTermS26,
        title: "Officer roster review",
        body: "Review ambiguous workbook rows and pending food bank submissions before the Friday officer meeting.",
        audience: "officers",
        status: "scheduled",
        pinned: false,
        published_at: null,
        scheduled_for: "2026-04-03T08:00:00-07:00",
        created_by: users.csfOfficer.id,
        updated_by: users.csfOfficer.id,
      },
    ]),
  );

  await must(
    "csf-expanded-audit-events",
    pluginDb.from("csf_admin_audit_events").upsert(
      [
        {
          id: "10000000-0000-4000-8000-000000000219",
          organization_id: IDS.csfOrg,
          actor_user_id: users.csfOfficer.id,
          action: "sheets.preview",
          target_type: "csf_sheet_sources",
          target_id: IDS.csfSheetSource,
          term_id: IDS.csfTermS26,
          after_data: { rows: 6, ambiguous: 1, warnings: 1 },
          created_at: "2026-03-18T18:10:00-07:00",
        },
        {
          id: "10000000-0000-4000-8000-000000000220",
          organization_id: IDS.csfOrg,
          actor_user_id: users.csfOfficer.id,
          action: "submission.approved",
          target_type: "csf_point_submissions",
          target_id: "10000000-0000-4000-8000-000000000206",
          term_id: IDS.csfTermS26,
          after_data: { title: "Food bank sorting verified", points: 3 },
          created_at: "2026-03-21T13:25:00-07:00",
        },
      ],
      { onConflict: "id", ignoreDuplicates: true },
    ),
  );
  } // end DVHS CSF fixtures (isolated and hosted-development modes only)

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
