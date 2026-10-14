// The two initial integration reads are safe only for independently observed
// empty fictional connection/configuration records. A connected Sheets getter
// can refresh a credential and probe Google, so it is deliberately refused.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  INVITATION_ORG_ID,
  verifyInvitationFixture,
} from "./invitation-reader-contract.mjs";
export const INTEGRATION_ROUTE =
  "/organization/local-platform-org/settings?section=integrations";
export const INTEGRATION_SOURCE_HASHES = Object.freeze({
  "app/organization/[id]/settings/page.tsx":
    "5866cd00ad686e5920e3b71dacf21b9d54186a2fbe9e2db53fe313291d2cdd45",
  "app/organization/[id]/settings/OrganizationSettingsShell.tsx":
    "47f3bb55e2acf2a28af43427b7db1b273b1ca977e12b9cc4bf7dd8e41915492d",
  "app/organization/[id]/settings/OrganizationCalendarSettings.tsx":
    "de73e0ff041782e34d98219fb8cb9b166b41d0f1de72eb08188b89754f9c73e0",
  "app/organization/[id]/settings/OrganizationSheetsSettings.tsx":
    "666186ae62183bb9778a0b6babc214a6db59d1f69b817e3102f9b153e44166df",
  "app/organization/[id]/calendar/actions.ts":
    "8d130350aaeaede45599ce6d68db49ff692d977f757b264ffebe568a42265bf0",
  "app/organization/[id]/reports/sheets-actions.ts":
    "a23da493edf8cb9117445d316ea1559bff0a9efd4f503ce95dad92b22188befa",
  "app/organization/[id]/reports/server/status.ts":
    "0c7292704c00baf2e5a048e59fde583448fab25caa23232ec42596f8c480584a",
  "app/organization/[id]/reports/server/shared.ts":
    "3a91af481cbcdff5cef31838651da769fbd254806176bf103aaa1f7c51d922cc",
  "app/organization/[id]/reports/server/destination-probe.ts":
    "5d18832a14693b9b27a6fe17f9fb5594af1fc33ccea614573790e42bbf9ba0a9",
  "app/organization/[id]/reports/sheets/useSheetSyncSetup.ts":
    "c2f2ab02b3efc12aa26dc69d5f2b86138815693db4569899d7e72834fe34d02b",
  "services/calendar.ts":
    "23c0803b8b66cd7bffb8036e24e6cf36f22d7a2b8c0dcc5738b1ca9b9a305d4d",
  "lib/auth/google-oauth-connection-store.ts":
    "49d261815b5a7b92d87032b8a46d20da2cbdfb7aecb0c64720467d24b1eaa5ae",
  "lib/auth/google-oauth-credential-client.ts":
    "6f350feb5b1f5ef4b9e3ac7b762c7969b2e3ed1a755797dfbeed11a7fb303d85",
  "lib/supabase/server.ts":
    "8add4e79df8c1aef46c0dca72086d67b2e98eb1366f780ef7124505ee565a52a",
  "lib/supabase/admin.ts":
    "c0c47cff0b65bfc041a1c5aaeb8636799aa5c757b94fcc34dc9e5ddd7cdd5e83",
  "scripts/local-dev/seed-platform.mjs":
    "f3804612896f53936ebf8e016a43995d6e606ed3ed330c5f3a4e0d5613c5dce3",
  "scripts/local-dev/seed-platform-fixtures.mjs":
    "d4163df937c0ceb2e1389457c579b9edef9d664fe4b3502a2f6a80fe12a2cd4f",
});
const deny = () => {
  throw Error("Exact disconnected fictional integration reader refused");
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const worker = "app/organization/[id]/settings/page";
const specs = [
  {
    exportedName: "getOrganizationCalendarStatus",
    sourceFile: "app/organization/[id]/calendar/actions.ts",
  },
  {
    exportedName: "getSheetSyncStatus",
    sourceFile: "app/organization/[id]/reports/server/status.ts",
  },
];
export function verifyIntegrationSources(repo, hashes) {
  if (
    !hashes ||
    Object.keys(hashes).sort().join("\n") !==
      Object.keys(INTEGRATION_SOURCE_HASHES).sort().join("\n")
  )
    deny();
  for (const [file, sha] of Object.entries(INTEGRATION_SOURCE_HASHES)) {
    const target = path.join(repo, file),
      st = fs.lstatSync(target);
    if (
      hashes[file] !== sha ||
      !st.isFile() ||
      st.isSymbolicLink() ||
      st.uid !== process.getuid() ||
      fs.realpathSync(target) !== target ||
      hash(fs.readFileSync(target)) !== sha
    )
      deny();
  }
}
export function integrationFixtureFromRows(organizationProof, actor, rows) {
  verifyInvitationFixture(organizationProof, actor);
  for (const name of [
    "calendarSyncs",
    "sheetSyncs",
    "organizationBindings",
    "viewerConnections",
  ])
    if (!Array.isArray(rows?.[name]) || rows[name].length !== 0) deny();
  return {
    schema: "lets-assist-integration-reader-fixture-v1",
    actorKey: actor.key,
    actorId: actor.id,
    organizationId: INVITATION_ORG_ID,
    calendarConfigAbsent: true,
    sheetConfigAbsent: true,
    organizationBindingsAbsent: true,
    viewerConnectionsAbsent: true,
  };
}
export function verifyIntegrationFixture(proof, organizationProof, actor) {
  verifyInvitationFixture(organizationProof, actor);
  if (
    proof?.schema !== "lets-assist-integration-reader-fixture-v1" ||
    proof.actorKey !== actor.key ||
    proof.actorId !== actor.id ||
    proof.organizationId !== INVITATION_ORG_ID ||
    [
      proof.calendarConfigAbsent,
      proof.sheetConfigAbsent,
      proof.organizationBindingsAbsent,
      proof.viewerConnectionsAbsent,
    ].some((v) => v !== true)
  )
    deny();
}
export async function collectDisconnectedIntegrationFixture(
  admin,
  organizationProof,
  actor,
) {
  verifyInvitationFixture(organizationProof, actor);
  // Select only identity columns and stop at the first row. Never read tokens.
  const reads = await Promise.all([
    admin
      .from("organization_calendar_syncs")
      .select("organization_id")
      .eq("organization_id", INVITATION_ORG_ID)
      .range(0, 0),
    admin
      .from("organization_sheet_syncs")
      .select("organization_id")
      .eq("organization_id", INVITATION_ORG_ID)
      .range(0, 0),
    admin
      .from("user_google_oauth_connection_bindings")
      .select("organization_id")
      .eq("organization_id", INVITATION_ORG_ID)
      .range(0, 0),
    admin
      .from("user_calendar_connections")
      .select("user_id")
      .eq("user_id", actor.id)
      .range(0, 0),
  ]);
  if (reads.some((r) => r.error)) deny();
  const names = [
    "calendarSyncs",
    "sheetSyncs",
    "organizationBindings",
    "viewerConnections",
  ];
  return integrationFixtureFromRows(
    organizationProof,
    actor,
    Object.fromEntries(reads.map((r, i) => [names[i], r.data])),
  );
}
export function integrationPolicyFromCompiled(
  compiled,
  repo,
  manifestSha,
  hashes,
) {
  verifyIntegrationSources(repo, hashes);
  if (!/^[a-f0-9]{64}$/u.test(manifestSha)) deny();
  const approvedActions = specs.map((spec) => {
    const matches = Object.entries(compiled.node ?? {}).filter(
      ([, v]) =>
        v?.exportedName === spec.exportedName &&
        typeof v.filename === "string" &&
        path.resolve(repo, v.filename) === path.join(repo, spec.sourceFile),
    );
    if (matches.length !== 1) deny();
    const [actionId, mapping] = matches[0];
    if (
      !/^[a-f0-9]{40,64}$/u.test(actionId) ||
      !Object.hasOwn(mapping.workers ?? {}, worker)
    )
      deny();
    return { ...spec, worker, actionId };
  });
  return {
    enabled: true,
    reviewed: true,
    compiledManifestSha256: manifestSha,
    sourceHashes: hashes,
    approvedActions,
  };
}
export function exactIntegrationPolicy(repo, buildDirectory, policy) {
  if (policy?.enabled !== true) return [];
  if (policy.reviewed !== true) deny();
  const file = path.join(
      buildDirectory,
      "server/server-reference-manifest.json",
    ),
    st = fs.lstatSync(file);
  if (
    !st.isFile() ||
    st.isSymbolicLink() ||
    st.uid !== process.getuid() ||
    fs.realpathSync(file) !== file
  )
    deny();
  const bytes = fs.readFileSync(file),
    sha = hash(bytes);
  if (sha !== policy.compiledManifestSha256) deny();
  const expected = integrationPolicyFromCompiled(
    JSON.parse(bytes),
    repo,
    sha,
    policy.sourceHashes,
  );
  if (
    JSON.stringify(expected.approvedActions) !==
    JSON.stringify(policy.approvedActions)
  )
    deny();
  return expected.approvedActions;
}
export function integrationReaderRequest({
  method,
  url,
  contentType,
  actionId,
  body,
  actor,
  entry,
  baseURL,
  approvedActions,
  organizationProof,
  integrationProof,
}) {
  verifyIntegrationFixture(integrationProof, organizationProof, actor);
  if (
    method !== "POST" ||
    typeof body !== "string" ||
    Buffer.byteLength(body) > 512 ||
    !/^text\/plain(?:;\s*charset=utf-8)?$/iu.test(contentType ?? "") ||
    entry?.id !== "organization-settings-integrations" ||
    entry.actorKey !== "developer" ||
    entry.route !== INTEGRATION_ROUTE
  )
    deny();
  const u = new URL(url);
  if (
    u.origin !== baseURL ||
    u.username ||
    u.password ||
    u.hash ||
    u.pathname + u.search !== INTEGRATION_ROUTE
  )
    deny();
  const action = approvedActions.find((a) => a.actionId === actionId),
    spec = specs.find(
      (s) =>
        s.exportedName === action?.exportedName &&
        s.sourceFile === action?.sourceFile,
    );
  if (
    !spec ||
    action.worker !== worker ||
    !entry.readActions?.includes(spec.exportedName)
  )
    deny();
  let args;
  try {
    args = JSON.parse(body);
  } catch {
    deny();
  }
  if (
    !Array.isArray(args) ||
    JSON.stringify(args) !== JSON.stringify([INVITATION_ORG_ID])
  )
    deny();
  return true;
}
