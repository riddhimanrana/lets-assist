import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  createAttendanceCheckoutCapability,
  createAttendancePresence,
  createAttendanceQrChallenge,
  verifyAttendanceCheckoutCapability,
  verifyAttendancePresence,
  verifyAttendanceQrChallenge,
} from "./challenge";

const SECRET = "test-only-attendance-challenge-secret-32-bytes";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const SCHEDULE_ID = "oneTime";
const SIGNUP_ID = "33333333-3333-4333-8333-333333333333";
const ANONYMOUS_SIGNUP_ID = "44444444-4444-4444-8444-444444444444";
const NOW = Date.UTC(2026, 6, 11, 12, 0, 0);

function createQrChallenge() {
  return createAttendanceQrChallenge(
    {
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      scheduleId: SCHEDULE_ID,
      startsAt: NOW + 60 * 60 * 1_000,
      endsAt: NOW + 4 * 60 * 60 * 1_000,
    },
    {
      now: NOW,
      secret: SECRET,
      nonce: "qr-nonce-that-is-long-enough-for-validation-123456",
    },
  );
}

test("QR challenge is signed and bound to project, session, and schedule", () => {
  const created = createQrChallenge();
  const verified = verifyAttendanceQrChallenge(
    created.token,
    {
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      scheduleId: SCHEDULE_ID,
    },
    { now: NOW, secret: SECRET },
  );

  assert.equal(verified.ok, true);
  assert.deepEqual(
    verifyAttendanceQrChallenge(
      created.token,
      { projectId: "33333333-3333-4333-8333-333333333333" },
      { now: NOW, secret: SECRET },
    ),
    { ok: false, reason: "binding_mismatch" },
  );
});

test("tampered, early, and expired QR challenges fail closed", () => {
  const created = createQrChallenge();
  const [payload, signature] = created.token.split(".");
  const decoded = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  );
  decoded.scheduleId = "other";
  const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString(
    "base64url",
  );

  assert.deepEqual(
    verifyAttendanceQrChallenge(
      `${tamperedPayload}.${signature}`,
      {},
      { now: NOW, secret: SECRET },
    ),
    { ok: false, reason: "invalid_token" },
  );

  assert.deepEqual(
    verifyAttendanceQrChallenge(
      created.token,
      {},
      {
        now: NOW - 3 * 60 * 60 * 1_000,
        secret: SECRET,
      },
    ),
    { ok: false, reason: "not_active" },
  );

  assert.deepEqual(
    verifyAttendanceQrChallenge(
      created.token,
      {},
      {
        now: NOW + 4 * 60 * 60 * 1_000,
        secret: SECRET,
      },
    ),
    { ok: false, reason: "expired" },
  );
});

test("presence proof is short lived and cannot be substituted with a QR token", () => {
  const qr = createQrChallenge();
  const presence = createAttendancePresence(qr.payload, {
    now: NOW,
    secret: SECRET,
    nonce: "presence-nonce-that-is-long-enough-for-validation-123",
  });

  assert.equal(
    verifyAttendancePresence(
      presence.token,
      { projectId: PROJECT_ID, scheduleId: SCHEDULE_ID },
      { now: NOW + 1_000, secret: SECRET },
    ).ok,
    true,
  );
  assert.deepEqual(
    verifyAttendancePresence(qr.token, {}, { now: NOW, secret: SECRET }),
    { ok: false, reason: "invalid_token" },
  );
  assert.deepEqual(
    verifyAttendancePresence(
      presence.token,
      {},
      {
        now: NOW + 5 * 60 * 1_000,
        secret: SECRET,
      },
    ),
    { ok: false, reason: "expired" },
  );
});

test("anonymous checkout capability is signed, longer lived, and identity-bound", () => {
  const capability = createAttendanceCheckoutCapability(
    {
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      scheduleId: SCHEDULE_ID,
      signupId: SIGNUP_ID,
      anonymousSignupId: ANONYMOUS_SIGNUP_ID,
      expiresAt: NOW + 4 * 60 * 60 * 1_000,
    },
    {
      now: NOW,
      secret: SECRET,
      nonce: "checkout-nonce-that-is-long-enough-for-validation-123",
    },
  );

  assert.equal(
    verifyAttendanceCheckoutCapability(
      capability.token,
      {
        projectId: PROJECT_ID,
        signupId: SIGNUP_ID,
        anonymousSignupId: ANONYMOUS_SIGNUP_ID,
      },
      { now: NOW + 60 * 60 * 1_000, secret: SECRET },
    ).ok,
    true,
  );
  assert.deepEqual(
    verifyAttendanceCheckoutCapability(
      capability.token,
      { signupId: "55555555-5555-4555-8555-555555555555" },
      { now: NOW, secret: SECRET },
    ),
    { ok: false, reason: "binding_mismatch" },
  );
  assert.deepEqual(
    verifyAttendanceCheckoutCapability(
      capability.token,
      {},
      { now: NOW + 4 * 60 * 60 * 1_000, secret: SECRET },
    ),
    { ok: false, reason: "expired" },
  );
});

test("attendance Server Actions require signed presence and never return stored anonymous tokens", () => {
  const prepareActions = readFileSync(
    join(process.cwd(), "app/attend/[projectId]/prepare/actions.ts"),
    "utf8",
  );
  const attendanceActions = readFileSync(
    join(process.cwd(), "app/attend/[projectId]/actions.ts"),
    "utf8",
  );
  const qrActions = readFileSync(
    join(process.cwd(), "app/projects/[id]/attendance/qr-actions.ts"),
    "utf8",
  );

  assert.doesNotMatch(prepareActions, /setAttendanceCookie/u);
  assert.match(prepareActions, /verifyAttendanceQrChallenge/u);
  assert.match(attendanceActions, /requireAttendancePresence/u);
  assert.doesNotMatch(attendanceActions, /anonAccessToken/u);
  assert.match(attendanceActions, /getAnonymousSignupAccessRecord/u);
  assert.match(attendanceActions, /verifyAttendanceCheckoutCapability/u);
  assert.doesNotMatch(attendanceActions, /overrideTime/u);
  assert.match(qrActions, /getAuthUser\(\{ sensitive: true \}\)/u);
});
