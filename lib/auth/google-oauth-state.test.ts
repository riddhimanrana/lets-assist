import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createGoogleOAuthState,
  normalizeGoogleOAuthReturnTo,
  verifyGoogleOAuthState,
} from "./google-oauth-state";

const SECRET = "test-only-google-oauth-state-secret-32-bytes";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOW = Date.UTC(2026, 6, 11, 12, 0, 0);

function createState() {
  return createGoogleOAuthState(
    {
      userId: USER_ID,
      returnTo: "/organization/example/settings?tab=calendar",
      orgId: "22222222-2222-4222-8222-222222222222",
      isCalendarSync: true,
    },
    {
      now: NOW,
      secret: SECRET,
      nonce: "nonce-value-that-is-long-enough-for-validation-1234",
    },
  );
}

test("accepts a valid state bound to its HttpOnly cookie nonce and user", () => {
  const created = createState();
  const result = verifyGoogleOAuthState({
    state: created.state,
    cookieNonce: created.nonce,
    currentUserId: USER_ID,
    now: NOW + 1_000,
    secret: SECRET,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(
      result.payload.returnTo,
      "/organization/example/settings?tab=calendar",
    );
  }
});

test("rejects a tampered state payload", () => {
  const created = createState();
  const [payload, signature] = created.state.split(".");
  const decoded = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  );
  decoded.userId = "33333333-3333-4333-8333-333333333333";
  const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString(
    "base64url",
  );

  assert.deepEqual(
    verifyGoogleOAuthState({
      state: `${tamperedPayload}.${signature}`,
      cookieNonce: created.nonce,
      currentUserId: USER_ID,
      now: NOW + 1_000,
      secret: SECRET,
    }),
    { ok: false, reason: "invalid_state" },
  );
});

test("rejects replay after the one-time nonce cookie has been consumed", () => {
  const created = createState();

  assert.deepEqual(
    verifyGoogleOAuthState({
      state: created.state,
      cookieNonce: null,
      currentUserId: USER_ID,
      now: NOW + 1_000,
      secret: SECRET,
    }),
    { ok: false, reason: "missing_cookie" },
  );
});

test("rejects a state created for another signed-in user", () => {
  const created = createState();

  assert.deepEqual(
    verifyGoogleOAuthState({
      state: created.state,
      cookieNonce: created.nonce,
      currentUserId: "33333333-3333-4333-8333-333333333333",
      now: NOW + 1_000,
      secret: SECRET,
    }),
    { ok: false, reason: "user_mismatch" },
  );
});

test("rejects expired state", () => {
  const created = createState();

  assert.deepEqual(
    verifyGoogleOAuthState({
      state: created.state,
      cookieNonce: created.nonce,
      currentUserId: USER_ID,
      now: NOW + 5 * 60 * 1_000,
      secret: SECRET,
    }),
    { ok: false, reason: "expired_state" },
  );
});

test("allows only same-origin relative return paths", () => {
  assert.equal(
    normalizeGoogleOAuthReturnTo("/account/calendar?connected=1"),
    "/account/calendar?connected=1",
  );
  assert.equal(normalizeGoogleOAuthReturnTo("https://evil.example"), null);
  assert.equal(normalizeGoogleOAuthReturnTo("//evil.example/path"), null);
  assert.equal(normalizeGoogleOAuthReturnTo("/\\evil.example/path"), null);
  assert.equal(normalizeGoogleOAuthReturnTo(" /account/calendar"), null);
});

test("the connect route uses the shared return-path normalizer on denial redirects", () => {
  const source = readFileSync(
    `${process.cwd()}/app/api/calendar/google/connect/route.ts`,
    "utf8",
  );

  assert.match(source, /const safeReturnTo = normalizeGoogleOAuthReturnTo\(returnTo\)/u);
  assert.doesNotMatch(source, /returnTo\.startsWith\("\/"\)/u);
});
