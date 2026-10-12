// Explicit offline checks only. No browser, requests, records or live receipts.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  NOTIFICATION_SOURCE_HASHES,
  verifyNotificationReaderProof,
  notificationReaderFrame,
  notificationTopicCategory,
  notificationFailureReason,
} from "./notification-reader-contract.mjs";
import { readAxeRows } from "./axe-color-diagnostics.mjs";
const actor = { kind: "baseline", id: "10000000-0000-4000-8000-000000000001" },
  token = "OFFLINE_TOKEN_DO_NOT_EMIT",
  topic = `realtime:global-notifications:${actor.id}`,
  join = [
    "2",
    "2",
    topic,
    "phx_join",
    {
      access_token: token,
      config: {
        broadcast: { ack: false, self: false },
        presence: { key: "", enabled: false },
        private: false,
        postgres_changes: ["INSERT", "UPDATE"].map((event) => ({
          event,
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${actor.id}`,
        })),
      },
    },
  ];
let checks = 0;
const pass = (fn) => {
    fn();
    checks++;
  },
  deny = (fn) => {
    assert.throws(fn);
    checks++;
  };
pass(() =>
  assert.equal(
    notificationReaderFrame(JSON.stringify(join), actor, token),
    "notification-join",
  ),
);
pass(() =>
  assert.equal(
    notificationTopicCategory(JSON.stringify(join), actor),
    "self-notifications",
  ),
);
for (const change of [
  (v) => {
    v[0] = null;
  },
  (v) => {
    v[1] = "3";
  },
  (v) => {
    v[0] = v[1] = "0";
  },
  (v) => {
    v[0] = v[1] = "00";
  },
  (v) => {
    v[0] = v[1] = "X";
  },
  (v) => {
    v[0] = v[1] = "1".repeat(13);
  },
  (v) => {
    v[2] += "-extra";
  },
  (v) => {
    v[3] = "phx_leave";
  },
  (v) => {
    v[3] = "access_token";
  },
  (v) => {
    v[3] = "broadcast";
  },
  (v) => {
    v[3] = "presence";
  },
  (v) => {
    v[3] = "business";
  },
  (v) => {
    v[4].access_token = "FOREIGN_TOKEN";
  },
  (v) => {
    v[4].extra = true;
  },
  (v) => {
    v[4].config.private = true;
  },
  (v) => {
    v[4].config.broadcast.self = true;
  },
  (v) => {
    v[4].config.broadcast.ack = true;
  },
  (v) => {
    v[4].config.presence.enabled = true;
  },
  (v) => {
    v[4].config.presence.key = "secret";
  },
  (v) => {
    v[4].config.postgres_changes.reverse();
  },
  (v) => {
    v[4].config.postgres_changes.pop();
  },
  (v) => {
    v[4].config.postgres_changes.push(v[4].config.postgres_changes[0]);
  },
  (v) => {
    v[4].config.postgres_changes[0].event = "*";
  },
  (v) => {
    v[4].config.postgres_changes[0].table = "profiles";
  },
  (v) => {
    v[4].config.postgres_changes[1].schema = "private";
  },
  (v) => {
    v[4].config.postgres_changes[0].filter = "user_id=eq.OTHER";
  },
  (v) => {
    v[4].config.postgres_changes[0].extra = true;
  },
]) {
  const v = structuredClone(join);
  change(v);
  deny(() => notificationReaderFrame(JSON.stringify(v), actor, token));
}
for (const frame of [
  Buffer.from("PRIVATE_BINARY"),
  "PRIVATE_BAD_JSON",
  "X".repeat(8193),
  JSON.stringify({ topic }),
  JSON.stringify(join.slice(0, 4)),
])
  deny(() => notificationReaderFrame(frame, actor, token));
for (const a of [null, { ...actor, kind: "hours" }, { ...actor, id: "OTHER" }])
  deny(() => notificationReaderFrame(JSON.stringify(join), a, token));
pass(() => {
  const foreign = structuredClone(join);
  foreign[2] = "realtime:global-notifications:PRIVATE_ID";
  const out = notificationTopicCategory(JSON.stringify(foreign), actor);
  assert.equal(out, "other-notifications");
  assert(!out.includes("PRIVATE_ID"));
});
pass(() =>
  assert.equal(
    notificationFailureReason(Error("Notification fresh token refused")),
    "notification-token",
  ),
);
pass(() =>
  assert.equal(
    notificationFailureReason(Error("PRIVATE_ERROR " + token)),
    "unknown",
  ),
);
deny(() =>
  verifyNotificationReaderProof("/OFFLINE_ONLY", {
    notificationReaderSourceHashes: {},
  }),
);
if (process.argv[2]) {
  const proof = {
    notificationReaderSourceHashes: { ...NOTIFICATION_SOURCE_HASHES },
  };
  pass(() => verifyNotificationReaderProof(process.argv[2], proof));
  for (const change of [
    (p) => {
      delete p.notificationReaderSourceHashes[
        Object.keys(NOTIFICATION_SOURCE_HASHES)[0]
      ];
    },
    (p) => {
      p.notificationReaderSourceHashes.extra = "X";
    },
    (p) => {
      p.notificationReaderSourceHashes[
        Object.keys(NOTIFICATION_SOURCE_HASHES)[0]
      ] = "0".repeat(64);
    },
  ]) {
    const bad = structuredClone(proof);
    change(bad);
    deny(() => verifyNotificationReaderProof(process.argv[2], bad));
  }
}
const secret = "PRIVATE_TEXT_HTML_SELECTOR_URL_IDENTIFIER",
  node = {
    html: secret,
    target: [secret],
    any: [
      {
        id: "color-contrast",
        data: {
          fgColor: "#ABCDEF",
          bgColor: "#123456",
          contrastRatio: 3.12,
          expectedContrastRatio: "4.5:1",
          fontSize: secret,
          message: secret,
        },
      },
    ],
  },
  element = {
    tagName: "BUTTON",
    closest: (selector) => (selector === "#org-tooling" ? {} : null),
  };
async function colors(nodes, include = true, el = element) {
  const rows = [{ id: "color-contrast", impact: "serious", nodes }];
  return JSON.parse(
    JSON.stringify(
      await vm.runInNewContext(
        `(${readAxeRows.toString()})({includeColorDetails:${include}})`,
        {
          window: { axe: { run: async () => ({ violations: rows }) } },
          document: { querySelector: () => el },
        },
        { timeout: 1000 },
      ),
    ),
  );
}
const result = await colors([node]);
pass(() =>
  assert.deepEqual(result[0].colorDetails, [
    {
      region: "org-tooling",
      tag: "button",
      foreground: "#abcdef",
      background: "#123456",
      contrastRatio: 3.12,
      expectedRatio: 4.5,
    },
  ]),
);
pass(() => assert(!JSON.stringify(result).includes(secret)));
pass(() =>
  assert.equal(
    Object.keys(result[0].colorDetails[0]).sort().join(","),
    "background,contrastRatio,expectedRatio,foreground,region,tag",
  ),
);
const capped = await colors(Array.from({ length: 12 }, () => node));
pass(() => assert.equal(capped[0].colorDetails.length, 8));
pass(() => assert.equal(capped[0].colorDetailsTruncated, true));
const opaque = await colors([node], false);
pass(() => assert(!Object.hasOwn(opaque[0], "colorDetails")));
for (const data of [
  {
    fgColor: "red",
    bgColor: "rgba(0,0,0,1)",
    contrastRatio: Infinity,
    expectedContrastRatio: secret,
  },
  {
    fgColor: "#fff",
    bgColor: "#ffffff00",
    contrastRatio: NaN,
    expectedContrastRatio: "99:1",
  },
  {
    fgColor: secret,
    bgColor: secret,
    contrastRatio: 0,
    expectedContrastRatio: 0,
  },
]) {
  const bad = structuredClone(node);
  bad.any[0].data = data;
  const row = (
    await colors([bad], true, { tagName: secret, closest: () => null })
  )[0].colorDetails[0];
  pass(() =>
    assert.deepEqual(row, {
      region: "other",
      tag: "other",
      foreground: null,
      background: null,
      contrastRatio: null,
      expectedRatio: null,
    }),
  );
  pass(() => assert(!JSON.stringify(row).includes(secret)));
}
const delta = fs.readFileSync(
  new URL("./capture.mjs", import.meta.url),
  "utf8",
);
const callbackMarker = "socket.onMessage(",
  callbackStart = delta.indexOf(callbackMarker) + callbackMarker.length,
  callbackEnd = delta.indexOf("\n          });", callbackStart),
  callbackCode = delta.slice(callbackStart, callbackEnd) + "\n          }",
  refused = [],
  sent = [],
  sandbox = {
    actor,
    profileAccessToken: token,
    allowedFrames: 0,
    allowedJoins: 0,
    allowedNotificationJoins: 0,
    profileReaderFrame: () => {
      throw Error("profile-only");
    },
    profileReaderDiagnostic: () => ({
      phase: "frame",
      event: "phx_join",
      reason: "event-or-channel",
    }),
    notificationReaderFrame,
    notificationTopicCategory,
    notificationFailureReason,
    connection: { server: { send: () => sent.push(true) } },
    refuse: (diagnostic) => refused.push(diagnostic),
    fail: () => {
      throw Error("fixed bound");
    },
  },
  handler = vm.runInNewContext("(" + callbackCode + ")", sandbox, {
    timeout: 1000,
  });
handler(JSON.stringify(join));
handler(JSON.stringify(join));
pass(() => assert.equal(sent.length, 1));
pass(() => assert.equal(refused.length, 1));
pass(() => assert.equal(refused[0].phase, "bounds"));
pass(() =>
  assert(
    !JSON.stringify(refused).includes(token) &&
      !JSON.stringify(refused).includes(actor.id),
  ),
);
pass(() => assert(delta.includes("allowedNotificationJoins >= 1")));
pass(() => assert(delta.includes("++allowedFrames > 512")));
pass(() =>
  assert(
    delta.includes("faults.blockedMutation++") &&
      delta.includes('await route.abort("blockedbyclient")'),
  ),
);
pass(() =>
  assert(
    delta.includes(
      'includeColorDetails: entry.id === "landing-baseline" && !actor',
    ),
  ),
);
console.log(
  JSON.stringify({
    offlineNotificationAndColorChecks: checks,
    framesSent: 0,
    requestsSent: 0,
    browserStarted: false,
    stackStarted: false,
    pixelsInspected: 0,
    canonicalRuntimeProof: false,
  }),
);
