#!/usr/bin/env node
// Actual owned loopback reads only. Never seeds, signs in or logs raw rows.
import fs from "node:fs";
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
export function fixtureProofFromRows({
  binding,
  accounts,
  users,
  profiles,
  projects,
  ids,
}) {
  const expected = baselineContracts(accounts);
  if (expected.length !== 22 || users.length !== 22 || profiles.length !== 22)
    fail("Exact22 baseline corpus required");
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
  for (let page = 1; page <= 2; page++) {
    const r = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (r.error || !Array.isArray(r.data?.users)) os.deny();
    users.push(...r.data.users);
    if (users.length > 22) os.deny();
    if (r.data.users.length < 1000) break;
  }
  const profileRead = await admin
    .from("profiles")
    .select("id,email,username,full_name,avatar_url,phone")
    .order("id")
    .range(0, 22);
  if (profileRead.error || !Array.isArray(profileRead.data)) os.deny();
  const seed = await import(
      pathToFileURL(
        path.join(REPO, "scripts/local-dev/seed-platform-fixtures.mjs"),
      )
    ),
    projectRead = await admin
      .from("projects")
      .select("id,creator_id")
      .in("id", [seed.IDS.publicProject, seed.IDS.orgProject]);
  if (projectRead.error || !Array.isArray(projectRead.data)) os.deny();
  const proof = fixtureProofFromRows({
    binding: BINDING,
    accounts: seed.buildSeedFixtureSets(true).seededAccounts,
    users,
    profiles: profileRead.data,
    projects: projectRead.data,
    ids: seed.IDS,
  });
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
