// Exact own-actor notification JOIN only; no lifecycle or business sends.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
export const NOTIFICATION_SOURCE_HASHES = Object.freeze({
  "components/providers/NotificationContext.tsx":
    "cb7373e3520a95ccd7dfddae62a258ea81e4d6964f86073af063390032e91b6a",
  "components/providers/GlobalNotificationProvider.tsx":
    "cc6ff0741e56dde746a2c011e5a85cd00d859c57eb333bc9bd1243661daf70cd",
  "components/providers/AppProviders.tsx":
    "2aed9cfdd6717e6fdf5ac86a72f40db654caaf2303034ba266020c7ad60d18a7",
  "components/providers/notification-refresh.ts":
    "d3b09243caf731f2a3e222796f7b720b88cb071049366fc29dcc37ecb19371d6",
  "node_modules/@supabase/phoenix/assets/js/phoenix/push.js":
    "09ebf09ac836f67b982f5a9936a603b7198710a4bc71f9a3996bf465504e0d77",
  "node_modules/@supabase/phoenix/assets/js/phoenix/channel.js":
    "b2faff72bc9c136c8f4337cdcaa4fc9d3dd4bd35525c40a126d1b901f96621e5",
  "node_modules/@supabase/realtime-js/src/lib/serializer.ts":
    "1f4bc648881142502012c47a20f58810bd05fbb77ce1bbc8ec375cdb3c48128e",
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const fixed = (reason) => {
  throw Error(reason);
};
const exactKeys = (value, list) =>
  value &&
  Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).sort().join("\n") === [...list].sort().join("\n");
export function verifyNotificationReaderProof(repo, proof) {
  const hashes = proof?.notificationReaderSourceHashes;
  if (!exactKeys(hashes, Object.keys(NOTIFICATION_SOURCE_HASHES)))
    fixed("Notification source proof required");
  for (const [relative, sha] of Object.entries(NOTIFICATION_SOURCE_HASHES)) {
    const file = path.join(repo, relative),
      real = fs.realpathSync(file),
      st = fs.lstatSync(real);
    if (
      hashes[relative] !== sha ||
      !st.isFile() ||
      st.isSymbolicLink() ||
      st.uid !== process.getuid() ||
      (!relative.startsWith("node_modules/") && real !== file) ||
      (relative.startsWith("node_modules/") &&
        !real.startsWith(
          fs.realpathSync(path.join(repo, "node_modules")) + path.sep,
        )) ||
      createHash("sha256").update(fs.readFileSync(real)).digest("hex") !== sha
    )
      fixed("Notification source proof drifted");
  }
  return true;
}
export function notificationTopicCategory(frame, actor) {
  if (typeof frame !== "string" || Buffer.byteLength(frame) > 8192)
    return "other";
  try {
    const value = JSON.parse(frame),
      topic = Array.isArray(value) && value.length === 5 ? value[2] : null;
    if (typeof topic !== "string") return "other";
    if (
      topic === `realtime:global-notifications:${actor?.id}` &&
      actor?.kind === "baseline" &&
      UUID.test(actor.id)
    )
      return "self-notifications";
    if (topic.startsWith("realtime:global-notifications:"))
      return "other-notifications";
    if (topic.startsWith("realtime:profile-updates-")) return "profile-shaped";
    if (topic === "phoenix") return "phoenix";
  } catch {
    /* Never expose parse data. */
  }
  return "other";
}
export function notificationReaderFrame(frame, actor, token) {
  if (
    !actor ||
    actor.kind !== "baseline" ||
    !UUID.test(actor.id) ||
    typeof token !== "string" ||
    !token
  )
    fixed("Notification actor or token refused");
  if (typeof frame !== "string" || Buffer.byteLength(frame) > 8192)
    fixed("Notification frame type or size refused");
  let value;
  try {
    value = JSON.parse(frame);
  } catch {
    fixed("Notification frame envelope refused");
  }
  if (!Array.isArray(value) || value.length !== 5)
    fixed("Notification frame envelope refused");
  const [joinRef, ref, topic, event, payload] = value;
  if (
    typeof joinRef !== "string" ||
    !/^[1-9][0-9]{0,11}$/u.test(joinRef) ||
    joinRef !== ref
  )
    fixed("Notification join reference refused");
  if (
    event !== "phx_join" ||
    topic !== `realtime:global-notifications:${actor.id}`
  )
    fixed("Notification topic or lifecycle refused");
  if (
    !exactKeys(payload, ["config", "access_token"]) ||
    payload.access_token !== token
  )
    fixed("Notification fresh token refused");
  const config = payload.config;
  if (
    !exactKeys(config, [
      "broadcast",
      "presence",
      "postgres_changes",
      "private",
    ]) ||
    config.private !== false ||
    !exactKeys(config.broadcast, ["ack", "self"]) ||
    config.broadcast.ack !== false ||
    config.broadcast.self !== false ||
    !exactKeys(config.presence, ["key", "enabled"]) ||
    config.presence.key !== "" ||
    config.presence.enabled !== false ||
    !Array.isArray(config.postgres_changes) ||
    config.postgres_changes.length !== 2
  )
    fixed("Notification configuration refused");
  for (const [index, event] of ["INSERT", "UPDATE"].entries()) {
    const filter = config.postgres_changes[index];
    if (
      !exactKeys(filter, ["event", "schema", "table", "filter"]) ||
      filter.event !== event ||
      filter.schema !== "public" ||
      filter.table !== "notifications" ||
      filter.filter !== `user_id=eq.${actor.id}`
    )
      fixed("Notification own-actor filter refused");
  }
  return "notification-join";
}
const REASONS = new Map([
  ["Notification actor or token refused", "notification-actor-token"],
  ["Notification frame type or size refused", "notification-type-size"],
  ["Notification frame envelope refused", "notification-envelope"],
  ["Notification join reference refused", "notification-reference"],
  ["Notification topic or lifecycle refused", "notification-topic-lifecycle"],
  ["Notification fresh token refused", "notification-token"],
  ["Notification configuration refused", "notification-config"],
  ["Notification own-actor filter refused", "notification-filter"],
]);
export function notificationFailureReason(error) {
  try {
    return REASONS.get(error?.message) ?? "unknown";
  } catch {
    return "unknown";
  }
}
