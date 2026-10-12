// Only the two initial invitation-panel reads for the proved fictional admin.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
export const INVITATION_ORG_ID = "10000000-0000-4000-8000-000000000001";
export const INVITATION_ROUTE =
  "/organization/local-platform-org/settings?section=invitations";
export const INVITATION_SOURCE_HASHES = Object.freeze({
  "app/organization/[id]/settings/page.tsx":
    "5866cd00ad686e5920e3b71dacf21b9d54186a2fbe9e2db53fe313291d2cdd45",
  "app/organization/[id]/settings/OrganizationSettingsShell.tsx":
    "47f3bb55e2acf2a28af43427b7db1b273b1ca977e12b9cc4bf7dd8e41915492d",
  "app/organization/[id]/settings/StaffLinkDisplay.tsx":
    "7600f8cfd27b3847aee75cb29cc5b623d3964f0be0fba59042a31ee0bc1fd22f",
  "app/organization/[id]/settings/PendingInvitations.tsx":
    "8779548ac69fc4450295e3f10426511495b7bf2e1054b8a7a7f8bc380d42f7e9",
  "app/organization/[id]/settings/BulkImportSection.tsx":
    "0534f7726235eed46901525f41a4ee9f95bf7058e42ef41262f7479574b49ce3",
  "app/organization/[id]/settings/actions.ts":
    "39513ccf7d7b8ff1fd689adc2633b12fb7b1880edae89f7d92f0b00d008481a1",
  "app/organization/[id]/settings/server/profile.ts":
    "64935c929485fb33f6bb5d87a919c0b59ac965e0c2a704a7a2a5ea6b4f33b1c5",
  "app/organization/[id]/admin/actions.ts":
    "be4702d85ab4f1575a4d0b42a98729751147ea6de57534d8f4143a036b50ab11",
  "app/organization/[id]/admin/server/invitations.ts":
    "9f41662bb378a9b5b4ac4e46cc9b355821cd641711cef86e3d58adb91b90bfb2",
  "lib/organization/active-membership.ts":
    "952f712bf7d520b461d10d67601938bfcbf8edda520ca18ba667c8f5b0199e4c",
  "lib/supabase/auth-helpers.ts":
    "dd76b397455e7ecea380dbcdac913be5703b1a5714b2c0a109da569a64cb6a93",
  "lib/supabase/server.ts":
    "8add4e79df8c1aef46c0dca72086d67b2e98eb1366f780ef7124505ee565a52a",
  "lib/supabase/admin.ts":
    "c0c47cff0b65bfc041a1c5aaeb8636799aa5c757b94fcc34dc9e5ddd7cdd5e83",
  "scripts/local-dev/seed-platform.mjs":
    "f3804612896f53936ebf8e016a43995d6e606ed3ed330c5f3a4e0d5613c5dce3",
  "scripts/local-dev/seed-platform-fixtures.mjs":
    "d4163df937c0ceb2e1389457c579b9edef9d664fe4b3502a2f6a80fe12a2cd4f",
  "supabase/migrations/20261008030000_organization_profile_write_authorization.sql":
    "dd2803db7c27c46f706e095e5d4195484ae089a71e883ec63c6170fd1d223763",
});
const refuse = () => {
  throw Error("Exact fictional invitation reader refused");
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const specs = [
  {
    exportedName: "getOrganizationInvitations",
    sourceFile: "app/organization/[id]/admin/server/invitations.ts",
  },
  {
    exportedName: "getStaffLinkDetails",
    sourceFile: "app/organization/[id]/settings/server/profile.ts",
  },
];
const worker = "app/organization/[id]/settings/page";

export function verifyInvitationSources(repo, hashes) {
  if (
    !hashes ||
    Object.keys(hashes).sort().join("\n") !==
      Object.keys(INVITATION_SOURCE_HASHES).sort().join("\n")
  )
    refuse();
  for (const [file, sha] of Object.entries(INVITATION_SOURCE_HASHES)) {
    const target = path.join(repo, file),
      st = fs.lstatSync(target);
    if (
      hashes[file] !== sha ||
      !st.isFile() ||
      st.isSymbolicLink() ||
      fs.realpathSync(target) !== target ||
      st.uid !== process.getuid() ||
      digest(fs.readFileSync(target)) !== sha
    )
      refuse();
  }
}

export function invitationFixtureFromRows(organizations, memberships, actor) {
  if (
    organizations?.length !== 1 ||
    memberships?.length !== 1 ||
    actor?.kind !== "baseline" ||
    actor.key !== "developer" ||
    !UUID.test(actor.id)
  )
    refuse();
  const org = organizations[0],
    member = memberships[0];
  if (
    org.id !== INVITATION_ORG_ID ||
    org.username !== "local-platform-org" ||
    org.created_by !== actor.id ||
    [
      org.staff_join_token,
      org.staff_join_token_created_at,
      org.staff_join_token_expires_at,
      org.staff_join_token_issued_by,
    ].some((v) => v !== null) ||
    member.organization_id !== org.id ||
    member.user_id !== actor.id ||
    member.role !== "admin" ||
    member.status !== "active"
  )
    refuse();
  return {
    schema: "lets-assist-invitation-reader-fixture-v1",
    organizationId: org.id,
    organizationUsername: org.username,
    actorKey: "developer",
    actorId: actor.id,
    createdBy: actor.id,
    role: "admin",
    status: "active",
    staffTokenAbsent: true,
  };
}

export function verifyInvitationFixture(proof, actor) {
  if (
    proof?.schema !== "lets-assist-invitation-reader-fixture-v1" ||
    proof.organizationId !== INVITATION_ORG_ID ||
    proof.organizationUsername !== "local-platform-org" ||
    proof.actorKey !== "developer" ||
    actor?.kind !== "baseline" ||
    actor.key !== "developer" ||
    !UUID.test(actor.id) ||
    proof.actorId !== actor.id ||
    proof.createdBy !== actor.id ||
    proof.role !== "admin" ||
    proof.status !== "active" ||
    proof.staffTokenAbsent !== true
  )
    refuse();
}

export function invitationPolicyFromCompiled(
  compiled,
  repo,
  manifestSha,
  hashes,
) {
  verifyInvitationSources(repo, hashes);
  if (!/^[a-f0-9]{64}$/u.test(manifestSha)) refuse();
  const approvedActions = specs.map((spec) => {
    const candidates = Object.entries(compiled.node ?? {}).filter(
      ([, v]) =>
        v?.exportedName === spec.exportedName &&
        typeof v.filename === "string" &&
        path.resolve(repo, v.filename) === path.join(repo, spec.sourceFile),
    );
    if (candidates.length !== 1) refuse();
    const [actionId, mapping] = candidates[0];
    if (
      !/^[a-f0-9]{40,64}$/u.test(actionId) ||
      !Object.hasOwn(mapping.workers ?? {}, worker)
    )
      refuse();
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

export function exactInvitationPolicy(repo, buildDirectory, policy) {
  if (policy?.enabled !== true) return [];
  if (policy.reviewed !== true) refuse();
  const file = path.join(
      buildDirectory,
      "server/server-reference-manifest.json",
    ),
    st = fs.lstatSync(file);
  if (
    !st.isFile() ||
    st.isSymbolicLink() ||
    fs.realpathSync(file) !== file ||
    st.uid !== process.getuid()
  )
    refuse();
  const bytes = fs.readFileSync(file),
    sha = digest(bytes);
  if (sha !== policy.compiledManifestSha256) refuse();
  const expected = invitationPolicyFromCompiled(
    JSON.parse(bytes),
    repo,
    sha,
    policy.sourceHashes,
  );
  if (
    JSON.stringify(expected.approvedActions) !==
    JSON.stringify(policy.approvedActions)
  )
    refuse();
  return expected.approvedActions;
}

export function invitationReaderRequest({
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
}) {
  verifyInvitationFixture(organizationProof, actor);
  if (
    method !== "POST" ||
    typeof body !== "string" ||
    Buffer.byteLength(body) > 512 ||
    !/^text\/plain(?:;\s*charset=utf-8)?$/iu.test(contentType ?? "") ||
    entry?.id !== "organization-settings-invitations" ||
    entry.actorKey !== "developer" ||
    entry.route !== INVITATION_ROUTE
  )
    refuse();
  const u = new URL(url);
  if (
    u.origin !== baseURL ||
    u.username ||
    u.password ||
    u.hash ||
    u.pathname + u.search !== INVITATION_ROUTE
  )
    refuse();
  const action = approvedActions.find((a) => a.actionId === actionId);
  const spec = specs.find(
    (s) =>
      s.exportedName === action?.exportedName &&
      s.sourceFile === action?.sourceFile,
  );
  if (
    !spec ||
    action.worker !== worker ||
    !entry.readActions?.includes(spec.exportedName)
  )
    refuse();
  let args;
  try {
    args = JSON.parse(body);
  } catch {
    refuse();
  }
  const expected =
    spec.exportedName === "getStaffLinkDetails"
      ? [INVITATION_ORG_ID]
      : [INVITATION_ORG_ID, "pending", 1, 10];
  if (!Array.isArray(args) || JSON.stringify(args) !== JSON.stringify(expected))
    refuse();
  return true;
}
