// Offline contracts for the explicitly reviewed local capture readers.
// Never return or log WebSocket frames, JWTs, action request bodies or encryption keys.
import fs from "node:fs";
import path from "node:path";
import { UUID, SHA256, digest, fail } from "./capture-contract.mjs";
const plain = (x) => !!x && Object.getPrototypeOf(x) === Object.prototype;
const keys = (x, expected) =>
  plain(x) &&
  Object.keys(x).sort().join("\n") === [...expected].sort().join("\n");
const ref = (x) =>
  x === null || (typeof x === "string" && /^[0-9]{1,12}$/u.test(x));

export function profileReaderUrl(value, apiOrigin, anonKey, actor) {
  const api = new URL(apiOrigin),
    u = new URL(value);
  if (
    api.protocol !== "http:" ||
    api.hostname !== "127.0.0.1" ||
    !api.port ||
    api.pathname !== "/" ||
    api.search ||
    api.hash ||
    api.username ||
    api.password
  )
    fail("Exact owned loopback API origin required");
  if (!actor || actor.kind !== "baseline" || !UUID.test(actor.id))
    fail("Exact proved baseline actor required");
  const expected = new URL(api.origin);
  expected.protocol = "ws:";
  if (
    u.origin !== expected.origin ||
    u.pathname !== "/realtime/v1/websocket" ||
    u.hash ||
    u.username ||
    u.password ||
    [...u.searchParams.keys()].sort().join("\n") !== "apikey\nvsn" ||
    u.searchParams.get("apikey") !== anonKey ||
    u.searchParams.get("vsn") !== "2.0.0"
  )
    fail("Unreviewed WebSocket endpoint refused");
  return true;
}

export function profileReaderFrame(frame, actor, accessToken) {
  if (
    !actor ||
    actor.kind !== "baseline" ||
    !UUID.test(actor.id) ||
    typeof accessToken !== "string" ||
    !accessToken
  )
    fail("Fresh proved baseline identity required");
  if (typeof frame !== "string" || Buffer.byteLength(frame) > 8192)
    fail("Binary or oversized WebSocket frame refused");
  const v = JSON.parse(frame);
  if (!Array.isArray(v) || v.length !== 5 || !ref(v[0]) || !ref(v[1]))
    fail("Unreviewed Phoenix frame refused");
  const [, , topic, event, payload] = v;
  if (event === "heartbeat" && topic === "phoenix" && keys(payload, []))
    return "heartbeat";
  if (
    event !== "phx_join" ||
    typeof topic !== "string" ||
    !topic.startsWith("realtime:profile-updates-") ||
    !topic.endsWith(`-${actor.id}`)
  )
    fail("Business, presence or unreviewed channel traffic refused");
  const channelNonce = topic.slice(
    "realtime:profile-updates-".length,
    -(actor.id.length + 1),
  );
  if (
    !UUID.test(channelNonce) ||
    !keys(payload, ["config", "access_token"]) ||
    payload.access_token !== accessToken
  )
    fail("Profile reader must use the exact fresh actor token");
  const config = payload.config;
  if (
    !keys(config, ["broadcast", "presence", "postgres_changes", "private"]) ||
    config.private !== false ||
    !keys(config.broadcast, ["ack", "self"]) ||
    config.broadcast.ack !== false ||
    config.broadcast.self !== false ||
    !keys(config.presence, ["key", "enabled"]) ||
    config.presence.key !== "" ||
    config.presence.enabled !== false ||
    !Array.isArray(config.postgres_changes) ||
    config.postgres_changes.length !== 1
  )
    fail("Unreviewed subscription configuration refused");
  const filter = config.postgres_changes[0];
  if (
    !keys(filter, ["event", "schema", "table", "filter"]) ||
    filter.event !== "*" ||
    filter.schema !== "public" ||
    filter.table !== "profiles" ||
    filter.filter !== `id=eq.${actor.id}`
  )
    fail("Only the proved actor profile reader is permitted");
  return "profile-join";
}

// Diagnosis never authorizes traffic and returns only finite literal categories.
// It cannot expose the frame, topic, actor UUID, URL or token.
const PROFILE_EVENTS = new Set([
  "heartbeat",
  "phx_join",
  "access_token",
  "phx_leave",
  "broadcast",
  "presence",
]);
const PROFILE_REASONS = new Map([
  ["Fresh proved baseline identity required", "actor-or-token"],
  ["Binary or oversized WebSocket frame refused", "type-or-size"],
  ["Unreviewed Phoenix frame refused", "envelope"],
  [
    "Business, presence or unreviewed channel traffic refused",
    "event-or-channel",
  ],
  ["Profile reader must use the exact fresh actor token", "nonce-or-token"],
  ["Unreviewed subscription configuration refused", "configuration"],
  ["Only the proved actor profile reader is permitted", "profile-filter"],
]);
export function profileReaderDiagnostic(frame, actor, accessToken) {
  const result = { phase: "frame", event: "other", reason: "unknown" };
  if (typeof frame === "string" && Buffer.byteLength(frame) <= 8192) {
    try {
      const value = JSON.parse(frame);
      if (
        Array.isArray(value) &&
        value.length === 5 &&
        PROFILE_EVENTS.has(value[3])
      )
        result.event = value[3];
    } catch {
      result.reason = "json";
    }
  }
  try {
    profileReaderFrame(frame, actor, accessToken);
    result.reason = "accepted";
  } catch (error) {
    // Exact constant lookup only. A parse error or arbitrary exception is never
    // stringified, trimmed or copied into output.
    try {
      result.reason = PROFILE_REASONS.get(error?.message) ?? result.reason;
    } catch {
      result.reason = "unknown";
    }
  }
  return result;
}

export const READ_ACTION_SPECS = [
  {
    exportedName: "getLinkedIdentitiesAction",
    sourceFile: "app/account/email-actions.ts",
    worker: "app/account/profile/page",
    route: "/account/profile",
  },
  {
    exportedName: "getDataExportJobs",
    sourceFile: "app/account/security/actions.ts",
    worker: "app/account/security/page",
    route: "/account/security",
  },
  {
    exportedName: "getOrganizerSignupsWithWaiverStatus",
    sourceFile: "app/projects/[id]/signups/actions.ts",
    worker: "app/projects/[id]/signups/page",
    route: null,
  },
];
export const REVIEWED_SOURCE_FILES = [
  "app/account/email-actions.ts",
  "app/account/profile/page.tsx",
  "app/account/profile/ProfileClient.tsx",
  "app/account/profile/EmailAddressesSection.tsx",
  "app/account/security/actions.ts",
  "app/account/security/data-export-actions.ts",
  "app/projects/[id]/signups/actions.ts",
  "lib/projects/management-access.ts",
  "lib/waiver/signature-preview.ts",
  "lib/supabase/auth-helpers.ts",
  "lib/supabase/admin.ts",
  "lib/supabase/server.ts",
  "utils/auth/account-management.ts",
];
export function reviewedSourceHashes(repo) {
  return Object.fromEntries(
    REVIEWED_SOURCE_FILES.map((file) => [
      file,
      digest(fs.readFileSync(path.join(repo, file))),
    ]),
  );
}
export function readActionPolicyFromCompiled(
  compiled,
  repo,
  compiledSha256,
  sourceHashes,
) {
  if (
    !SHA256.test(compiledSha256) ||
    !keys(sourceHashes, REVIEWED_SOURCE_FILES)
  )
    fail("Exact compiled/source read-action identity required");
  const current = reviewedSourceHashes(repo);
  for (const file of REVIEWED_SOURCE_FILES)
    if (current[file] !== sourceHashes[file])
      fail("Reviewed read-action source changed");
  const approvedActions = [];
  for (const spec of READ_ACTION_SPECS) {
    const candidates = Object.entries(compiled.node ?? {}).filter(
      ([, value]) =>
        value?.exportedName === spec.exportedName &&
        typeof value.filename === "string" &&
        path.resolve(repo, value.filename) === path.join(repo, spec.sourceFile),
    );
    if (candidates.length !== 1)
      fail("Exact read-action compiled mapping absent or ambiguous");
    const [actionId, mapping] = candidates[0];
    if (
      !/^[a-f0-9]{40,64}$/u.test(actionId) ||
      !Object.hasOwn(mapping.workers ?? {}, spec.worker)
    )
      fail("Read-action worker identity mismatch");
    approvedActions.push({
      exportedName: spec.exportedName,
      sourceFile: spec.sourceFile,
      worker: spec.worker,
      actionId,
    });
  }
  return {
    enabled: false,
    reviewed: false,
    compiledManifestSha256: compiledSha256,
    sourceHashes,
    approvedActions,
  };
}
export function exactReadActionPolicy(repo, buildDirectory, policy) {
  if (policy?.enabled !== true) return [];
  if (policy.reviewed !== true)
    fail("Root review of the exact read-action policy required");
  const file = path.join(
    buildDirectory,
    "server/server-reference-manifest.json",
  );
  const st = fs.lstatSync(file);
  if (
    !st.isFile() ||
    st.isSymbolicLink() ||
    st.uid !== process.getuid() ||
    fs.realpathSync(path.dirname(file)) !== path.dirname(file)
  )
    fail("Owned exact compiled action manifest required");
  const bytes = fs.readFileSync(file);
  if (digest(bytes) !== policy.compiledManifestSha256)
    fail("Compiled read-action manifest changed");
  const expected = readActionPolicyFromCompiled(
    JSON.parse(bytes),
    repo,
    digest(bytes),
    policy.sourceHashes,
  );
  if (
    JSON.stringify(expected.approvedActions) !==
    JSON.stringify(policy.approvedActions)
  )
    fail("Exact reviewed compiled action mapping required");
  return expected.approvedActions;
}
export function readActionRequest({
  method,
  url,
  contentType,
  actionId,
  body,
  actor,
  entry,
  baseURL,
  approvedActions,
  creatorProjects,
}) {
  if (
    method !== "POST" ||
    !actor ||
    actor.kind !== "baseline" ||
    !UUID.test(actor.id) ||
    typeof body !== "string" ||
    Buffer.byteLength(body) > 512 ||
    !/^text\/plain(?:;\s*charset=utf-8)?$/iu.test(contentType ?? "")
  )
    fail("Unreviewed action request refused");
  const u = new URL(url);
  if (u.origin !== baseURL || u.username || u.password || u.hash || u.search)
    fail("Exact local read-action route required");
  const action = approvedActions.find((a) => a.actionId === actionId);
  if (
    !action ||
    !Array.isArray(entry.readActions) ||
    !entry.readActions.includes(action.exportedName)
  )
    fail("Unreviewed action identity refused");
  const args = JSON.parse(body);
  if (!Array.isArray(args)) fail("Exact read-action arguments required");
  if (action.exportedName === "getLinkedIdentitiesAction") {
    if (
      u.pathname !== "/account/profile" ||
      entry.id !== "account-profile" ||
      entry.route !== "/account/profile" ||
      actor.key !== "member" ||
      args.length !== 0
    )
      fail("Exact own linked-email read required");
  } else if (action.exportedName === "getDataExportJobs") {
    if (
      u.pathname !== "/account/security" ||
      entry.route !== "/account/security" ||
      args.length !== 0
    )
      fail("Exact own export-history read required");
  } else if (action.exportedName === "getOrganizerSignupsWithWaiverStatus") {
    if (
      args.length !== 1 ||
      typeof args[0] !== "string" ||
      !UUID.test(args[0]) ||
      u.pathname !== `/projects/${args[0]}/signups` ||
      entry.route !== u.pathname ||
      creatorProjects.get(args[0]) !== actor.id
    )
      fail("Exact proved creator project roster read required");
  } else fail("Unknown read action refused");
  return true;
}

// The creator project loads its attendee projection on mount. Supabase sends
// this read-only RPC as POST, so the general RPC and mutation guards must still
// refuse every request except this exact proved fictional creator read.
export function projectRosterReaderRequest({
  method,
  url,
  headers,
  body,
  actor,
  entry,
  apiOrigin,
  anonKey,
  accessToken,
  creatorProjects,
}) {
  const projectId =
    typeof entry?.route === "string"
      ? entry.route.match(/^\/projects\/([0-9a-f-]{36})$/u)?.[1]
      : null;
  const api = new URL(apiOrigin);
  if (
    method !== "POST" ||
    entry?.id !== "project-creator" ||
    !projectId ||
    !UUID.test(projectId) ||
    actor?.kind !== "baseline" ||
    actor.key !== "csfAdmin" ||
    !UUID.test(actor.id) ||
    creatorProjects?.get(projectId) !== actor.id ||
    typeof accessToken !== "string" ||
    !accessToken ||
    typeof anonKey !== "string" ||
    !anonKey ||
    headers?.authorization !== `Bearer ${accessToken}` ||
    headers?.apikey !== anonKey ||
    !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(
      headers?.["content-type"] ?? "",
    ) ||
    (headers?.["content-profile"] !== undefined &&
      headers["content-profile"] !== "public") ||
    typeof body !== "string" ||
    Buffer.byteLength(body) > 128 ||
    api.protocol !== "http:" ||
    api.hostname !== "127.0.0.1" ||
    !api.port ||
    api.pathname !== "/" ||
    api.search ||
    api.hash ||
    api.username ||
    api.password
  )
    fail("Unreviewed project roster request refused");
  const expected = new URL("/rest/v1/rpc/get_public_attendees", api);
  const actual = new URL(url);
  if (
    actual.href !== expected.href ||
    actual.username ||
    actual.password ||
    actual.hash
  )
    fail("Exact local project roster endpoint required");
  const args = JSON.parse(body);
  if (
    !keys(args, ["p_project_id"]) ||
    args.p_project_id !== projectId ||
    body !== JSON.stringify({ p_project_id: projectId })
  )
    fail("Exact proved creator project argument required");
  return true;
}
