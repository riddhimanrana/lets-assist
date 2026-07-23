import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createGoogleOAuthState,
  isGoogleOAuthCsfImportCapability,
  normalizeGoogleOAuthReturnTo,
  verifyGoogleOAuthState,
} from "./google-oauth-state";

const SECRET = "test-only-google-oauth-state-secret-32-bytes";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOW = Date.UTC(2026, 6, 11, 12, 0, 0);

test("does not issue Google Picker capability for local-only report downloads", () => {
  assert.equal(
    isGoogleOAuthCsfImportCapability("export_sensitive_reports"),
    false,
  );
});

function createState() {
  return createGoogleOAuthState(
    {
      userId: USER_ID,
      returnTo: "/organization/example/settings?tab=calendar",
      organizationId: "22222222-2222-4222-8222-222222222222",
      purpose: "organization_calendar",
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
    assert.equal(result.payload.purpose, "organization_calendar");
    assert.equal(
      result.payload.organizationId,
      "22222222-2222-4222-8222-222222222222",
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

test("rejects a tampered CSF import capability", () => {
  const created = createGoogleOAuthState(
    {
      userId: USER_ID,
      returnTo: "/organization/dvhs-csf?tab=csf-imports",
      organizationId: "22222222-2222-4222-8222-222222222222",
      pluginKey: "dvhs-csf",
      purpose: "csf_import",
      requestedCapability: "import_members",
    },
    {
      now: NOW,
      secret: SECRET,
      nonce: "nonce-value-that-is-long-enough-for-validation-1234",
    },
  );
  const [payload, signature] = created.state.split(".");
  const decoded = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  );
  decoded.requestedCapability = "import_applications";
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

test("requires CSF import state to bind an organization, plugin, and capability", () => {
  assert.throws(
    () =>
      createGoogleOAuthState(
        {
          userId: USER_ID,
          purpose: "csf_import",
        },
        { now: NOW, secret: SECRET },
      ),
    /Invalid Google OAuth connection purpose/u,
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

  assert.match(
    source,
    /const safeReturnTo = normalizeGoogleOAuthReturnTo\(returnTo\)/u,
  );
  assert.doesNotMatch(source, /returnTo\.startsWith\("\/"\)/u);
});

test("both OAuth endpoints enforce the shared authorization before token storage", () => {
  const connectSource = readFileSync(
    `${process.cwd()}/app/api/calendar/google/connect/route.ts`,
    "utf8",
  );
  const callbackSource = readFileSync(
    `${process.cwd()}/app/api/calendar/google/callback/route.ts`,
    "utf8",
  );

  assert.match(connectSource, /authorizeGoogleOAuthOrganizationRequest\(/u);
  const callbackAuthorizationCalls = [
    ...callbackSource.matchAll(/authorizeGoogleOAuthOrganizationRequest\(/gu),
  ];
  assert.equal(
    callbackAuthorizationCalls.length,
    2,
    "callback must authorize before Google calls and reauthorize before save",
  );
  const firstAuthorizationIndex = callbackSource.indexOf(
    "authorizeGoogleOAuthOrganizationRequest(",
  );
  const finalAuthorizationIndex = callbackSource.lastIndexOf(
    "authorizeGoogleOAuthOrganizationRequest(",
  );
  const tokenExchangeIndex = callbackSource.indexOf(
    'fetch("https://oauth2.googleapis.com/token"',
  );
  const userInfoIndex = callbackSource.indexOf(
    'fetch(\n      "https://www.googleapis.com/oauth2/v2/userinfo"',
  );
  const connectionReadIndex = callbackSource.indexOf(
    "getGoogleOAuthConnectionForBinding(",
  );
  const connectionSaveIndex = callbackSource.indexOf(
    "saveGoogleOAuthConnectionForBinding({",
  );
  assert.ok(
    [
      firstAuthorizationIndex,
      finalAuthorizationIndex,
      tokenExchangeIndex,
      userInfoIndex,
      connectionReadIndex,
      connectionSaveIndex,
    ].every((index) => index >= 0),
    "callback authorization, Google calls, and bound credential operations must remain explicit",
  );
  assert.ok(
    firstAuthorizationIndex < tokenExchangeIndex,
    "callback authorization must run before exchanging or storing tokens",
  );
  assert.ok(
    firstAuthorizationIndex < connectionReadIndex,
    "callback authorization must run before reading or storing a connection",
  );
  assert.ok(
    finalAuthorizationIndex > userInfoIndex,
    "callback must reauthorize after external Google calls",
  );
  assert.ok(
    finalAuthorizationIndex < connectionSaveIndex,
    "callback must reauthorize immediately before the atomic bound credential save",
  );
});
