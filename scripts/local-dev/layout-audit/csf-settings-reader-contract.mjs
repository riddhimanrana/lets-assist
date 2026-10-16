// Only the three initial CSF Settings reads in a proved disconnected fixture.
// Connected OAuth, test-workspace recovery and all write actions stay refused.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
export const CSF_SETTINGS_ROUTE = "/organization/dvhs-csf?tab=csf-settings";
export const CSF_SETTINGS_SOURCE_HASHES = Object.freeze({
  "lib/plugins/private/plugins/dvhs-csf/actions.ts":
    "fa83726c1b058f95d17f60ca743132c940dc158023f7c3017c96864fba0cdf6e",
  "lib/plugins/private/plugins/dvhs-csf/components/CsfSettingsWorkspace.tsx":
    "78ea409769652a13e89bc64f8f843fb97c563e38dc715b3e5fc24ac33c1e9432",
  "lib/plugins/private/plugins/dvhs-csf/components/CsfGoogleSheetsConnectionPanel.tsx":
    "8a9689f8625b206f8151e7d9a915e4f4f1e79c1c109690ea311d1072af6d0a88",
  "lib/plugins/private/plugins/dvhs-csf/components/CsfSheetSyncPanel.tsx":
    "f1f449c6c0965daa1ef43203020f3d3371c80cdce1ec86cdff89d73e789dcb95",
  "lib/plugins/private/plugins/dvhs-csf/components/useCsfSheetSyncWorkspace.ts":
    "c7a9c82b09c624e317b5fe0d1c05279d76d334141ce20106becc1a7bb6e1ae34",
  "lib/plugins/private/plugins/dvhs-csf/components/CsfSheetSemesterLedger.tsx":
    "83fbbcc33e77812121221e17887e35d31b34eb169051c2e3a349ee59f6ab6d2b",
  "lib/plugins/private/plugins/dvhs-csf/sheet-sync-actions.ts":
    "90ab30b23f282065732e580c8004bf0867c37b7613755dde1b90b16a489c6ce6",
  "lib/plugins/private/plugins/dvhs-csf/sheet-semester-ledger-actions.ts":
    "b1a591b55285fc4da7ade7f91fe380b25c4edfc92edfbc2e3e99e8315cf6fb1c",
  "lib/plugins/private/plugins/dvhs-csf/server/actions/import-google.ts":
    "160dcf2afd1316a2e8d2b9ffeb37146965429159bcbb27f5cc895c39b95bd44b",
  "lib/plugins/private/plugins/dvhs-csf/server/actions/support-authorization.ts":
    "76a7ff11b30a338c9d5cb5deaad39cc5fec6d773bdf15664a7b7cc86cf75b7fd",
  "lib/plugins/private/plugins/dvhs-csf/server/actions/support-types.ts":
    "d3db031b4b49237a496dbe5f6e9476daa538047f3f18d07c375bed9bfe1280ba",
  "lib/plugins/private/plugins/dvhs-csf/services/roles.ts":
    "04acacfd3b97f022f0f0904513fa31e5ce237ed2f306fc2e4f50518b143156f8",
  "lib/plugins/private/plugins/dvhs-csf/services/scoped-permissions.ts":
    "7955fec7f2621fe2faf375c3d0add53403a632d927d693e1d5b707c3a231b3cb",
  "lib/auth/google-oauth-connection-store.ts":
    "49d261815b5a7b92d87032b8a46d20da2cbdfb7aecb0c64720467d24b1eaa5ae",
  "lib/auth/google-oauth-credential-client.ts":
    "6f350feb5b1f5ef4b9e3ac7b762c7969b2e3ed1a755797dfbeed11a7fb303d85",
  "lib/auth/google-oauth-csf-identity.ts":
    "908711b5b9722112d185ed161c8ddfbd0f3909225840b6944a29c323d872eb06",
  "lib/auth/google-oauth-state.ts":
    "3b0a8debf9d31e5417588cd4c2e648aa7121a354830de5053f48ccb47b344896",
  "lib/plugins/runtime-access.ts":
    "1887fcb060c855c2187b5fd1bbd00df226bad77b418e4dd7060b377f07803f62",
  "lib/plugins/supabase.ts":
    "84cf1152c8d6692e2a0149232c98fa1c18e509bcefa4ce2101a3cc7be5964611",
  "lib/supabase/server.ts":
    "8add4e79df8c1aef46c0dca72086d67b2e98eb1366f780ef7124505ee565a52a",
  "lib/supabase/admin.ts":
    "c0c47cff0b65bfc041a1c5aaeb8636799aa5c757b94fcc34dc9e5ddd7cdd5e83",
  "lib/supabase/auth-helpers.ts":
    "dd76b397455e7ecea380dbcdac913be5703b1a5714b2c0a109da569a64cb6a93",
  "services/calendar.ts":
    "23c0803b8b66cd7bffb8036e24e6cf36f22d7a2b8c0dcc5738b1ca9b9a305d4d",
  "services/calendar-operations.ts":
    "f67bb2d385878dbe07c458d0769dc574bfebb131666ce6a4e25b8f9944997622",
  "scripts/local-dev/seed-platform.mjs":
    "f3804612896f53936ebf8e016a43995d6e606ed3ed330c5f3a4e0d5613c5dce3",
  "scripts/local-dev/seed-platform-fixtures.mjs":
    "d4163df937c0ceb2e1389457c579b9edef9d664fe4b3502a2f6a80fe12a2cd4f",
  "lib/plugins/published-releases.ts":
    "fdafaad31daacc55fee485452b89dead2de82952f006435797ab4399fed00f68",
  "lib/plugins/published-releases.json":
    "2d8287fb9f4e3e1f62a3803d75cd2e7ce82a6dc327d598e65a2c5c03963cf01d",
  "lib/plugins/versioning.ts":
    "a9cd63a629cc7ab4289ea54d325c5cc7d26c16c1da637b24c6041033eaedfb74",
});
const worker = "app/organization/[id]/page";
export const CSF_SETTINGS_READERS = Object.freeze([
  {
    exportedName: "getCsfSheetsConnectionStatusAction",
    sourceFile:
      "lib/plugins/private/plugins/dvhs-csf/server/actions/import-google.ts",
    capability: "import_members",
  },
  {
    exportedName: "getCsfSheetSyncWorkspaceAction",
    sourceFile: "lib/plugins/private/plugins/dvhs-csf/sheet-sync-actions.ts",
  },
  {
    exportedName: "getCsfSheetSemesterLedgerWorklistAction",
    sourceFile:
      "lib/plugins/private/plugins/dvhs-csf/sheet-semester-ledger-actions.ts",
  },
]);
const deny = () => {
  throw Error("Exact disconnected fictional CSF Settings reader refused");
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const uuid = (value) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value);
function acceptedMinimumVersion(value) {
  if (value === null) return true;
  if (
    typeof value !== "string" ||
    !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(value)
  )
    return false;
  const parts = value.split(".").map(Number);
  if (!parts.every(Number.isSafeInteger)) return false;
  const current = [1, 2, 89];
  for (let i = 0; i < 3; i++)
    if (parts[i] !== current[i]) return parts[i] < current[i];
  return true;
}
function actorGuard(actor, organizationId) {
  if (
    actor?.kind !== "baseline" ||
    actor.key !== "csfAdmin" ||
    !uuid(actor.id) ||
    !uuid(organizationId)
  )
    deny();
}
export function verifyCsfSettingsSources(repo, hashes) {
  if (
    !hashes ||
    JSON.stringify(Object.keys(hashes).sort()) !==
      JSON.stringify(Object.keys(CSF_SETTINGS_SOURCE_HASHES).sort())
  )
    deny();
  for (const [file, sha] of Object.entries(CSF_SETTINGS_SOURCE_HASHES)) {
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
export function csfSettingsFixtureFromRows(actor, organizationId, rows) {
  actorGuard(actor, organizationId);
  const one = (name) => {
    if (!Array.isArray(rows?.[name]) || rows[name].length !== 1) deny();
    return rows[name][0];
  };
  const org = one("organizations"),
    member = one("memberships"),
    entitlement = one("entitlements"),
    install = one("installs"),
    access = one("runtimeAccess");
  if (
    org.id !== organizationId ||
    org.username !== "dvhs-csf" ||
    member.organization_id !== organizationId ||
    member.user_id !== actor.id ||
    member.role !== "admin" ||
    member.status !== "active" ||
    entitlement.organization_id !== organizationId ||
    entitlement.plugin_key !== "dvhs-csf" ||
    entitlement.status !== "active" ||
    install.organization_id !== organizationId ||
    install.plugin_key !== "dvhs-csf" ||
    install.enabled !== true ||
    install.installed_version !== "1.2.89" ||
    access.organization_id !== organizationId ||
    access.plugin_key !== "dvhs-csf" ||
    access.is_accessible !== true ||
    access.latest_version !== "1.2.89" ||
    !acceptedMinimumVersion(access.force_update_version)
  )
    deny();
  for (const name of [
    "organizationBindings",
    "actorBindings",
    "connections",
    "testWorkspaces",
    "destinations",
  ])
    if (!Array.isArray(rows?.[name]) || rows[name].length !== 0) deny();
  return {
    schema: "lets-assist-csf-settings-reader-fixture-v1",
    actorKey: actor.key,
    actorId: actor.id,
    organizationId,
    organizationUsername: "dvhs-csf",
    role: "admin",
    status: "active",
    pluginKey: "dvhs-csf",
    installedVersion: "1.2.89",
    entitled: true,
    runtimeAccessible: true,
    installed: true,
    organizationBindingsAbsent: true,
    actorBindingsAbsent: true,
    connectionsAbsent: true,
    testWorkspaceAbsent: true,
    destinationsAbsent: true,
  };
}
export function verifyCsfSettingsFixture(proof, actor, organizationId) {
  actorGuard(actor, organizationId);
  const expected = csfSettingsFixtureFromRows(actor, organizationId, {
    organizations: [{ id: organizationId, username: "dvhs-csf" }],
    memberships: [
      {
        organization_id: organizationId,
        user_id: actor.id,
        role: "admin",
        status: "active",
      },
    ],
    entitlements: [
      {
        organization_id: organizationId,
        plugin_key: "dvhs-csf",
        status: "active",
      },
    ],
    installs: [
      {
        organization_id: organizationId,
        plugin_key: "dvhs-csf",
        enabled: true,
        installed_version: "1.2.89",
      },
    ],
    runtimeAccess: [
      {
        organization_id: organizationId,
        plugin_key: "dvhs-csf",
        is_accessible: true,
        latest_version: "1.2.89",
        force_update_version: null,
      },
    ],
    organizationBindings: [],
    actorBindings: [],
    connections: [],
    testWorkspaces: [],
    destinations: [],
  });
  if (JSON.stringify(proof) !== JSON.stringify(expected)) deny();
}
export async function collectCsfSettingsFixture(admin, actor, organizationId) {
  actorGuard(actor, organizationId);
  // Identity/state columns only. No tokens, credential payloads or configuration.
  const reads = await Promise.all([
    admin
      .from("organization_plugin_access")
      .select(
        "organization_id,plugin_key,is_accessible,latest_version,force_update_version",
      )
      .eq("organization_id", organizationId)
      .eq("plugin_key", "dvhs-csf")
      .range(0, 1),
    admin
      .from("organizations")
      .select("id,username")
      .eq("id", organizationId)
      .range(0, 1),
    admin
      .from("organization_members")
      .select("organization_id,user_id,role,status")
      .eq("organization_id", organizationId)
      .eq("user_id", actor.id)
      .range(0, 1),
    admin
      .from("organization_plugin_entitlements")
      .select("organization_id,plugin_key,status")
      .eq("organization_id", organizationId)
      .eq("plugin_key", "dvhs-csf")
      .range(0, 1),
    admin
      .from("organization_plugin_installs")
      .select("organization_id,plugin_key,enabled,installed_version")
      .eq("organization_id", organizationId)
      .eq("plugin_key", "dvhs-csf")
      .range(0, 1),
    admin
      .from("user_google_oauth_connection_bindings")
      .select("organization_id")
      .eq("organization_id", organizationId)
      .range(0, 0),
    admin
      .from("user_google_oauth_connection_bindings")
      .select("user_id")
      .eq("user_id", actor.id)
      .range(0, 0),
    admin
      .from("user_calendar_connections")
      .select("user_id")
      .eq("user_id", actor.id)
      .range(0, 0),
    admin
      .schema("plugin_data")
      .from("csf_sheet_sync_test_workspaces")
      .select("organization_id")
      .eq("organization_id", organizationId)
      .range(0, 0),
    admin
      .schema("plugin_data")
      .from("csf_sheet_sync_destinations")
      .select("organization_id")
      .eq("organization_id", organizationId)
      .range(0, 0),
  ]);
  if (reads.some((r) => r.error)) deny();
  const names = [
    "runtimeAccess",
    "organizations",
    "memberships",
    "entitlements",
    "installs",
    "organizationBindings",
    "actorBindings",
    "connections",
    "testWorkspaces",
    "destinations",
  ];
  return csfSettingsFixtureFromRows(
    actor,
    organizationId,
    Object.fromEntries(reads.map((r, i) => [names[i], r.data])),
  );
}
export function csfSettingsPolicyFromCompiled(
  compiled,
  repo,
  manifestSha,
  hashes,
) {
  verifyCsfSettingsSources(repo, hashes);
  if (!/^[a-f0-9]{64}$/u.test(manifestSha)) deny();
  const approvedActions = CSF_SETTINGS_READERS.map((spec) => {
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
export function exactCsfSettingsPolicy(repo, buildDirectory, policy) {
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
  const expected = csfSettingsPolicyFromCompiled(
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
export async function csfSettingsReaderRequest({
  admin,
  method,
  url,
  contentType,
  actionId,
  body,
  actor,
  entry,
  baseURL,
  approvedActions,
  fixtureProof,
  organizationId,
}) {
  verifyCsfSettingsFixture(fixtureProof, actor, organizationId);
  if (
    method !== "POST" ||
    typeof body !== "string" ||
    Buffer.byteLength(body) > 512 ||
    !/^text\/plain(?:;\s*charset=utf-8)?$/iu.test(contentType ?? "") ||
    entry?.id !== "csf-settings" ||
    entry.actorKey !== "csfAdmin" ||
    entry.route !== CSF_SETTINGS_ROUTE
  )
    deny();
  const u = new URL(url);
  if (
    u.origin !== baseURL ||
    u.username ||
    u.password ||
    u.hash ||
    u.pathname + u.search !== CSF_SETTINGS_ROUTE
  )
    deny();
  const action = approvedActions.find((a) => a.actionId === actionId),
    spec = CSF_SETTINGS_READERS.find(
      (s) =>
        s.exportedName === action?.exportedName &&
        s.sourceFile === action?.sourceFile &&
        s.capability === action?.capability,
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
  const expected = spec.capability
    ? [organizationId, spec.capability]
    : [organizationId];
  if (!Array.isArray(args) || JSON.stringify(args) !== JSON.stringify(expected))
    deny();
  const observed = await collectCsfSettingsFixture(
    admin,
    actor,
    organizationId,
  );
  if (JSON.stringify(observed) !== JSON.stringify(fixtureProof)) deny();
  return true;
}
