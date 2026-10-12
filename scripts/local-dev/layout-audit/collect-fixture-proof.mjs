#!/usr/bin/env node
// Actual owned loopback reads only. Never seeds, signs in or logs raw rows.
import fs from "node:fs";
import {
  invitationFixtureFromRows,
  INVITATION_ORG_ID,
} from "./invitation-reader-contract.mjs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { BINDING, REPO, requireLiveBinding } from "./linux-binding.mjs";
import {
  baselineContracts,
  verifyFixtureRows,
  proofContracts,
  digest,
  fail,
} from "./capture-contract.mjs";
const require = createRequire(import.meta.url),
  os = require("./linux-platform.cjs");
const DIAGNOSTIC_ACTOR_KEYS = new Set([
  "developer",
  "staff",
  "member",
  "outsider",
  "csfAdmin",
  "csfOfficer",
  "csfAdviser",
  "csfCoPresidentOne",
  "csfCoPresidentTwo",
  "csfVpMembership",
  "csfVpPublicity",
  "csfVpClubs",
  "csfTreasurer",
  "csfSecretary",
  "csfWebMaster",
  "csfActivityCoordinatorTwo",
  "csfActivityCoordinatorThree",
  "csfActivityCoordinatorFour",
  "csfActivityCoordinatorFive",
  "csfDataManagement",
  "csfApplicant",
  "csfMember",
]);
const diagnosticCount = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : null;
// Only counts and literal source actor keys can leave this boundary.
export function fixtureCorpusDiagnostics({
  accounts,
  users,
  profiles,
  observations = {},
}) {
  const known = accounts.filter((a) => DIAGNOSTIC_ACTOR_KEYS.has(a.key));
  const emails = new Set(known.map((a) => a.email));
  const knownAuthIds = new Set(
    users.filter((u) => emails.has(u.email)).map((u) => u.id),
  );
  return {
    sourceActorCount: accounts.length,
    unknownSourceActorCount: accounts.length - known.length,
    observedAuthCount: users.length,
    observedProfileCount: Array.isArray(profiles) ? profiles.length : null,
    missingAuthActorKeys: known
      .filter((a) => !users.some((u) => u.email === a.email))
      .map((a) => a.key),
    missingProfileActorKeys: Array.isArray(profiles)
      ? known
          .filter((a) => !profiles.some((p) => p.email === a.email))
          .map((a) => a.key)
      : null,
    unknownAuthCount: users.filter((u) => !emails.has(u.email)).length,
    unknownProfileObservedCount: Array.isArray(profiles)
      ? profiles.filter((p) => !emails.has(p.email) || !knownAuthIds.has(p.id))
          .length
      : null,
    duplicateKnownAuthCount: known.reduce(
      (n, a) =>
        n + Math.max(0, users.filter((u) => u.email === a.email).length - 1),
      0,
    ),
    profileReportedTotal: diagnosticCount(observations.profileReportedTotal),
    authPages: Array.isArray(observations.authPages)
      ? observations.authPages.map((p) => ({
          page: diagnosticCount(p.page),
          rowCount: diagnosticCount(p.rowCount),
          reportedTotal: diagnosticCount(p.reportedTotal),
          nextPage: diagnosticCount(p.nextPage),
        }))
      : [],
  };
}
export function fixtureProofFromRows({
  binding,
  accounts,
  users,
  profiles,
  projects,
  ids,
  observations,
}) {
  const expected = baselineContracts(accounts);
  if (expected.length !== 22 || users.length !== 22 || profiles.length !== 22)
    fail(
      "Exact22 baseline corpus required; " +
        JSON.stringify(
          fixtureCorpusDiagnostics({ accounts, users, profiles, observations }),
        ),
    );
  const contracts = expected.map((a) => {
    const rows = users.filter((u) => u.email === a.email);
    if (rows.length !== 1) fail("Exact actual Auth identity required");
    return {
      ...a,
      id: rows[0].id,
      metadata: { local_fixture: true },
      kind: "baseline",
    };
  });
  verifyFixtureRows(contracts, users, profiles);
  const actor = new Map(contracts.map((a) => [a.key, a]));
  const baselineProjects = [
    { id: ids.publicProject, creatorKey: "csfAdmin" },
    { id: ids.orgProject, creatorKey: "developer" },
  ].map((p) => {
    const rows = projects.filter((r) => r.id === p.id);
    if (rows.length !== 1 || rows[0].creator_id !== actor.get(p.creatorKey)?.id)
      fail("Exact actual creator proof required");
    return { ...p, creatorId: rows[0].creator_id };
  });
  if (projects.length !== 2) fail("Exact selected creator result required");
  const proof = {
    schema: "lets-assist-layout-fixture-proof-v2",
    template: false,
    syntheticOnly: true,
    seedMode: "csf-isolated-v1",
    runId: binding.runId,
    projectId: binding.projectId,
    baselineActors: contracts.map((a) => ({
      ...Object.fromEntries(
        Object.entries(a).filter(
          ([k]) => !["id", "metadata", "kind"].includes(k),
        ),
      ),
      userId: a.id,
    })),
    baselineProjects,
    retainedHoursCount: 0,
    observedAuthCount: 22,
    observedProfileCount: 22,
  };
  proofContracts(proof, binding, accounts, null);
  return proof;
}
export async function main(output) {
  requireLiveBinding();
  if (!output || !path.isAbsolute(output)) os.deny();
  os.privateDir(path.dirname(output));
  process.env.CSF_ISOLATED_WORK_DIR = BINDING.workDir;
  const dv = await import(
      pathToFileURL(path.join(REPO, "scripts/local-dev/dv-local-env.mjs"))
    ),
    marker = dv.inspectCsfIsolatedWorkDir(BINDING.workDir),
    local = dv.getCsfIsolatedSupabaseEnv();
  for (const k of [
    "workDir",
    "runId",
    "projectId",
    "apiPort",
    "databasePort",
    "databaseVolume",
  ])
    if (marker[k] !== BINDING[k]) os.deny();
  if (local.url !== `http://127.0.0.1:${BINDING.apiPort}`) os.deny();
  const clientRequire = createRequire(path.join(REPO, "package.json")),
    { createClient } = clientRequire("@supabase/supabase-js");
  const guardedFetch = (input, init) => {
    const u = new URL(typeof input === "string" ? input : input.url),
      method = (init?.method ?? input.method ?? "GET").toUpperCase();
    if (
      u.origin !== local.url ||
      u.username ||
      u.password ||
      method !== "GET" ||
      ![
        "/auth/v1/admin/users",
        "/rest/v1/profiles",
        "/rest/v1/projects",
        "/rest/v1/organizations",
        "/rest/v1/organization_members",
      ].includes(u.pathname)
    )
      os.deny();
    return fetch(input, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
  };
  const admin = createClient(local.url, local.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: guardedFetch },
    }),
    users = [];
  const seed = await import(
    pathToFileURL(
      path.join(REPO, "scripts/local-dev/seed-platform-fixtures.mjs"),
    )
  );
  const accounts = seed.buildSeedFixtureSets(true).seededAccounts;
  const observations = { authPages: [], profileReportedTotal: null };
  for (let page = 1; page <= 2; page++) {
    const r = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (r.error || !Array.isArray(r.data?.users)) os.deny();
    users.push(...r.data.users);
    observations.authPages.push({
      page,
      rowCount: r.data.users.length,
      reportedTotal: r.data.total,
      nextPage: r.data.nextPage,
    });
    if (users.length > 22)
      fail(
        "Exact22 Auth corpus required; " +
          JSON.stringify(
            fixtureCorpusDiagnostics({
              accounts,
              users,
              profiles: null,
              observations,
            }),
          ),
      );
    if (r.data.users.length < 1000) break;
  }
  const profileRead = await admin
    .from("profiles")
    .select("id,email,username,full_name,avatar_url,phone", { count: "exact" })
    .order("id")
    .range(0, 22);
  if (profileRead.error || !Array.isArray(profileRead.data)) os.deny();
  observations.profileReportedTotal = profileRead.count;
  const projectRead = await admin
    .from("projects")
    .select("id,creator_id")
    .in("id", [seed.IDS.publicProject, seed.IDS.orgProject]);
  if (projectRead.error || !Array.isArray(projectRead.data)) os.deny();
  const proof = fixtureProofFromRows({
    binding: BINDING,
    accounts,
    users,
    profiles: profileRead.data,
    projects: projectRead.data,
    ids: seed.IDS,
    observations,
  });
  const developer = proof.baselineActors.find((a) => a.key === "developer");
  const organizationRead = await admin
    .from("organizations")
    .select(
      "id,username,created_by,staff_join_token,staff_join_token_created_at,staff_join_token_expires_at,staff_join_token_issued_by",
    )
    .eq("id", INVITATION_ORG_ID)
    .range(0, 1);
  const membershipRead = await admin
    .from("organization_members")
    .select("organization_id,user_id,role,status")
    .eq("organization_id", INVITATION_ORG_ID)
    .eq("user_id", developer.userId)
    .range(0, 1);
  if (organizationRead.error || membershipRead.error)
    fail("Invitation fixture read failed");
  proof.invitationReaderOrganization = invitationFixtureFromRows(
    organizationRead.data,
    membershipRead.data,
    {
      kind: "baseline",
      key: "developer",
      id: developer.userId,
    },
  );
  requireLiveBinding();
  dv.getCsfIsolatedSupabaseEnv();
  os.exclusiveJSON(output, proof);
  process.stdout.write(
    JSON.stringify({
      fixtureProofFile: output,
      fixtureProofSha256: digest(fs.readFileSync(output)),
      actualActors: 22,
      retainedHoursCount: 0,
      fixtureWrites: 0,
      pixelsInspected: 0,
    }) + "\n",
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main(process.argv[2]);
