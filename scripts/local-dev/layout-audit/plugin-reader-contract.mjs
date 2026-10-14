// Exactly the initial plugin-settings getter for the owned fictional admin.
// Neighboring install/configuration/runtime/deletion actions stay refused.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  INVITATION_ORG_ID,
  verifyInvitationFixture,
} from "./invitation-reader-contract.mjs";
export const PLUGIN_ROUTE =
  "/organization/local-platform-org/settings?section=plugins";
export const PLUGIN_SOURCE_HASHES = Object.freeze({
  "app/organization/[id]/settings/page.tsx":
    "5866cd00ad686e5920e3b71dacf21b9d54186a2fbe9e2db53fe313291d2cdd45",
  "app/organization/[id]/settings/OrganizationSettingsShell.tsx":
    "47f3bb55e2acf2a28af43427b7db1b273b1ca977e12b9cc4bf7dd8e41915492d",
  "app/organization/[id]/settings/OrganizationPluginSettings.tsx":
    "e464d33fd0fb05b3dded835cbae1333b41bb1d35358128261ba8dfa994baaab1",
  "app/organization/[id]/settings/actions.ts":
    "39513ccf7d7b8ff1fd689adc2633b12fb7b1880edae89f7d92f0b00d008481a1",
  "app/organization/[id]/settings/server/plugin-query.ts":
    "accfd5900d470b5cb4619f98dd8b9b5f4efe45b0d41a4b269702abf0390ad3a1",
  "app/organization/[id]/settings/server/plugin-shared.ts":
    "e3f1405028d8e8a504cf5375215d95fc597af5d0b21a6888bf090e745f105036",
  "lib/organization/active-membership.ts":
    "952f712bf7d520b461d10d67601938bfcbf8edda520ca18ba667c8f5b0199e4c",
  "lib/supabase/server.ts":
    "8add4e79df8c1aef46c0dca72086d67b2e98eb1366f780ef7124505ee565a52a",
  "lib/supabase/admin.ts":
    "c0c47cff0b65bfc041a1c5aaeb8636799aa5c757b94fcc34dc9e5ddd7cdd5e83",
  "lib/supabase/auth-helpers.ts":
    "dd76b397455e7ecea380dbcdac913be5703b1a5714b2c0a109da569a64cb6a93",
  "lib/plugins/application-environment.ts":
    "604d44711e8ed5a08bee3631871842a564e9bb939923747ff72e0264a0924a7c",
  "lib/plugins/registry.ts":
    "4ce1028f0f540d3d00ad4cbdddd75a4e031c479275afa707266e6f072dd7d1fd",
  "lib/plugins/sdk-adoption.ts":
    "3bc56c56fa075b53f639f2aa61d90f9d3d3134ec3bcc278070d3dbfa99082d96",
  "lib/plugins/sdk/adapters/embedded.ts":
    "1a973104bf19f63fb4c9025e10830588aad87fd5c72394da300fff4b96f3e82d",
  "lib/plugins/published-releases.ts":
    "fdafaad31daacc55fee485452b89dead2de82952f006435797ab4399fed00f68",
  "lib/plugins/published-releases.json":
    "bfeab347daa2dfed0e81b0d70fcec9c7e8d6eee9f55b0dbf43041da1667ba64c",
  "lib/plugins/organization-plugin-settings.ts":
    "78c3b8983aaa531dff483e408a6879260194fe0871d9d9a5230c0264aa0d2c9a",
  "lib/plugins/plugin-uninstall-impact.ts":
    "6b4482dd8d5604cc2329f6b3e7b220180f41c25f1637a54e4e2a6629fc016812",
  "lib/plugins/plugin-data-deletion-readiness.ts":
    "8e7516baf4bca3207c24338cbf9e67250da62bb31f12220accd4ac01f9d10e88",
  "lib/plugins/sdk/v1/compatibility.ts":
    "43f30b2101a34cc5d6f26f37343519c5aa7b14a58e18db373b40c8ef145be5a7",
  "lib/plugins/sdk/v1/release.ts":
    "7bf5eb9d658bf299ca1b49306807546d78e220e8645e12a38f0d86fca9ef900c",
  "lib/plugins/sdk/v1/runtime-profile.ts":
    "1d589cfeaf477b31578bc8eb60b1f9173af2bad580c8e9065f219211365d1d23",
  "scripts/local-dev/seed-platform.mjs":
    "f3804612896f53936ebf8e016a43995d6e606ed3ed330c5f3a4e0d5613c5dce3",
  "scripts/local-dev/seed-platform-fixtures.mjs":
    "d4163df937c0ceb2e1389457c579b9edef9d664fe4b3502a2f6a80fe12a2cd4f",
  "supabase/migrations/20260821005258_add_plugin_application_runtime_admin_controls.sql":
    "da7b1a7b5fbd3b6aa669c94ab196bb7fcf61da8b610be6ae961b04c1cf797b0e",
  "supabase/migrations/20260822060000_harden_plugin_application_runtime_controls.sql":
    "be8f8b1f721f221f0833381db9a8c25ce835000467ffb48de269e23ba366cfbb",
  "supabase/migrations/20260822070000_complete_plugin_application_runtime_compatibility.sql":
    "ffdd0907629a0f27b15609f50359bd93d12cb2d2aaf036c1ef15beda05673de6",
  "supabase/migrations/20260822075815_make_plugin_application_runtime_transitions_idempotent.sql":
    "0e78f85e5c07a9b100a44b296acd17ab92b33f1d7b5dc462db6ea958b052a464",
  "supabase/migrations/20260822084356_route_plugin_applications_to_selected_deployments.sql":
    "1ecdc9351e175010ece30b5bbd8e113ba091355e8594701112f462a99e8095af",
});
const deny = () => {
  throw Error("Exact fictional plugin settings reader refused");
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const worker = "app/organization/[id]/settings/page";
const specs = [
  {
    exportedName: "getOrganizationPluginSettings",
    sourceFile: "app/organization/[id]/settings/server/plugin-query.ts",
  },
];
export function verifyPluginSources(repo, hashes) {
  if (
    !hashes ||
    Object.keys(hashes).sort().join("\n") !==
      Object.keys(PLUGIN_SOURCE_HASHES).sort().join("\n")
  )
    deny();
  for (const [file, sha] of Object.entries(PLUGIN_SOURCE_HASHES)) {
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
export function pluginPolicyFromCompiled(compiled, repo, manifestSha, hashes) {
  verifyPluginSources(repo, hashes);
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
export function exactPluginPolicy(repo, buildDirectory, policy) {
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
  const expected = pluginPolicyFromCompiled(
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
export function pluginReaderRequest({
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
    entry?.id !== "organization-settings-plugins" ||
    entry.actorKey !== "developer" ||
    entry.route !== PLUGIN_ROUTE ||
    JSON.stringify(entry.expectedRoutes) !== JSON.stringify([PLUGIN_ROUTE])
  )
    deny();
  const u = new URL(url);
  if (
    u.origin !== baseURL ||
    u.username ||
    u.password ||
    u.hash ||
    u.pathname + u.search !== PLUGIN_ROUTE
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
