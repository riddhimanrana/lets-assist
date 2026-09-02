import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createGoogleOAuthAttemptSecrets,
  digestGoogleOAuthSecret,
  digestGoogleOAuthSessionBinding,
  deriveGoogleOAuthPkceChallenge,
  getGoogleOAuthAttemptCookieName,
  getGoogleOAuthAttemptCookieOptions,
  parseGoogleOAuthState,
} from "./google-oauth-attempt";
import {
  resolveGoogleOAuthReturnRoute,
  getGoogleOAuthDefaultReturnRoute,
} from "./google-oauth-return-routes";
import {
  isGoogleOAuthCsfImportCapability,
  isValidGoogleOAuthIntent,
  normalizeGoogleOAuthReturnTo,
} from "./google-oauth-state";

const ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";

process.env.ENCRYPTION_KEY ??= "x".repeat(32);

test("does not issue Google Picker capability for local-only report downloads", () => {
  assert.equal(
    isGoogleOAuthCsfImportCapability("export_sensitive_reports"),
    false,
  );
});

// ---------------------------------------------------------------------------
// Attempt secrets: what the browser holds, and what the ledger stores.
// ---------------------------------------------------------------------------

test("issues a parseable state whose secret only ever reaches the ledger as a digest", () => {
  const secrets = createGoogleOAuthAttemptSecrets();
  const parsed = parseGoogleOAuthState(secrets.state);

  assert.ok(parsed);
  assert.equal(parsed.attemptRef, secrets.attemptRef);
  assert.equal(parsed.stateDigest, secrets.stateDigest);
  assert.equal(parsed.cookieName, secrets.cookieName);
  // The digest must not be reversible to the state Google echoes back.
  assert.ok(!secrets.state.includes(secrets.stateDigest));
  assert.match(secrets.stateDigest, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(secrets.cookieDigest, /^[A-Za-z0-9_-]{43}$/u);
});

test("gives every concurrent attempt its own cookie so tabs cannot overwrite each other", () => {
  const calendarAttempt = createGoogleOAuthAttemptSecrets();
  const csfAttempt = createGoogleOAuthAttemptSecrets();

  assert.notEqual(calendarAttempt.cookieName, csfAttempt.cookieName);
  assert.notEqual(calendarAttempt.state, csfAttempt.state);
  assert.notEqual(calendarAttempt.stateDigest, csfAttempt.stateDigest);
  assert.equal(
    calendarAttempt.cookieName,
    getGoogleOAuthAttemptCookieName(calendarAttempt.attemptRef),
  );
});

test("derives an S256 PKCE challenge and never sends the verifier with it", () => {
  const secrets = createGoogleOAuthAttemptSecrets();
  const rfc7636Verifier = [
    "dBjftJeZ4CVP",
    "-mB92K27uhbU",
    "JU1p1r_wW1g",
    "FWFOEjXk",
  ].join("");
  const rfc7636Challenge = [
    "E9Melhoa2Owv",
    "FrEMTJguCHao",
    "eK1t8URWbuGJ",
    "Sstw-cM",
  ].join("");

  assert.equal(
    deriveGoogleOAuthPkceChallenge(rfc7636Verifier),
    rfc7636Challenge,
  );
  assert.notEqual(secrets.codeChallenge, secrets.codeVerifier);
  // RFC 7636 allows 43-128 characters; 32 random bytes is 43 base64url.
  assert.ok(secrets.codeVerifier.length >= 43);
  assert.ok(secrets.codeVerifier.length <= 128);
  assert.match(secrets.codeChallenge, /^[A-Za-z0-9_-]{43}$/u);
});

test("issues a bounded, correlation-safe diagnostic code", () => {
  const secrets = createGoogleOAuthAttemptSecrets();

  assert.match(secrets.correlationId, /^[A-Z0-9]{10}$/u);
  assert.ok(!secrets.correlationId.includes(secrets.attemptRef));
});

test("rejects a malformed, tampered, or foreign-version state", () => {
  const secrets = createGoogleOAuthAttemptSecrets();
  const [version, attemptRef, digestKeyId, stateSecret] =
    secrets.state.split(".");

  assert.equal(parseGoogleOAuthState(null), null);
  assert.equal(parseGoogleOAuthState(""), null);
  assert.equal(parseGoogleOAuthState("not-a-state"), null);
  assert.equal(parseGoogleOAuthState(`v2.${attemptRef}.${stateSecret}`), null);
  assert.equal(parseGoogleOAuthState(`${version}.${attemptRef}`), null);
  assert.equal(
    parseGoogleOAuthState(`${version}.!!!.${digestKeyId}.${stateSecret}`),
    null,
  );
  assert.equal(
    parseGoogleOAuthState(`${version}.${attemptRef}.!.${stateSecret}`),
    null,
  );
  assert.equal(
    parseGoogleOAuthState(`${version}.${attemptRef}.${digestKeyId}.short`),
    null,
  );
});

test("a tampered state secret yields a different digest, so the ledger cannot match it", () => {
  const secrets = createGoogleOAuthAttemptSecrets();
  const [version, attemptRef, digestKeyId, stateSecret] =
    secrets.state.split(".");
  const flipped = `${stateSecret.slice(0, -1)}${stateSecret.endsWith("A") ? "B" : "A"}`;

  const parsed = parseGoogleOAuthState(
    `${version}.${attemptRef}.${digestKeyId}.${flipped}`,
  );
  assert.ok(parsed);
  assert.notEqual(parsed.stateDigest, secrets.stateDigest);
});

test("keeps an attempt verifiable while its named digest key is retained", () => {
  const previousKey = process.env.ENCRYPTION_KEY;
  const previousKeyring = process.env.ENCRYPTION_KEYRING;
  try {
    delete process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEYRING = JSON.stringify({
      activeKeyId: "oauth.old",
      keys: { "oauth.old": "o".repeat(32) },
    });
    const secrets = createGoogleOAuthAttemptSecrets();
    const originalSessionDigest = digestGoogleOAuthSessionBinding(
      "session-one",
      secrets.digestKeyId,
    );

    process.env.ENCRYPTION_KEYRING = JSON.stringify({
      activeKeyId: "oauth-current",
      keys: {
        "oauth-current": "c".repeat(32),
        "oauth.old": "o".repeat(32),
      },
    });
    const parsed = parseGoogleOAuthState(secrets.state);

    assert.ok(parsed);
    assert.equal(parsed.digestKeyId, "oauth.old");
    assert.equal(parsed.stateDigest, secrets.stateDigest);
    assert.equal(
      digestGoogleOAuthSessionBinding("session-one", parsed.digestKeyId),
      originalSessionDigest,
    );
  } finally {
    if (previousKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previousKey;
    if (previousKeyring === undefined) delete process.env.ENCRYPTION_KEYRING;
    else process.env.ENCRYPTION_KEYRING = previousKeyring;
  }
});

test("accepts an in-flight v3 attempt through the legacy fallback key", () => {
  const previousKey = process.env.ENCRYPTION_KEY;
  const previousKeyring = process.env.ENCRYPTION_KEYRING;
  try {
    process.env.ENCRYPTION_KEY = "l".repeat(32);
    process.env.ENCRYPTION_KEYRING = JSON.stringify({
      activeKeyId: "current",
      keys: { current: "l".repeat(32) },
    });
    const attemptRef = "A".repeat(24);
    const stateSecret = "B".repeat(43);
    const parsed = parseGoogleOAuthState(`v3.${attemptRef}.${stateSecret}`);

    assert.ok(parsed);
    assert.equal(parsed.digestKeyId, "legacy");
    assert.equal(
      parsed.stateDigest,
      digestGoogleOAuthSecret(stateSecret, "legacy"),
    );
  } finally {
    if (previousKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previousKey;
    if (previousKeyring === undefined) delete process.env.ENCRYPTION_KEYRING;
    else process.env.ENCRYPTION_KEYRING = previousKeyring;
  }
});

test("binds to the stable session claim rather than a rotating token", () => {
  assert.equal(digestGoogleOAuthSessionBinding(null), null);
  assert.equal(digestGoogleOAuthSessionBinding("   "), null);

  const first = digestGoogleOAuthSessionBinding("session-one");
  const second = digestGoogleOAuthSessionBinding("session-two");
  assert.match(String(first), /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(first, second);
  // The stored digest must not be the session identifier itself.
  assert.notEqual(first, "session-one");
});

test("keeps the attempt cookie HttpOnly and scoped to the callback route", () => {
  const options = getGoogleOAuthAttemptCookieOptions();

  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, "lax");
  assert.equal(options.path, "/api/google/oauth/callback");
  assert.ok(options.maxAge > 0);
});

// ---------------------------------------------------------------------------
// Return routes: purpose-specific allowlist, not arbitrary relative paths.
// ---------------------------------------------------------------------------

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

test("preserves the canonical CSF import return route", () => {
  const returnTo =
    "/organization/dvhs-csf?tab=csf-applications&csf_import_type=application_responses";
  const resolved = resolveGoogleOAuthReturnRoute({
    purpose: "csf_import",
    returnTo,
    organizationSegments: [ORGANIZATION_ID, "dvhs-csf"],
  });

  assert.equal(resolved.allowlisted, true);
  assert.equal(resolved.returnTo, returnTo);
});

test("preserves bounded application review state through a CSF reconnect", () => {
  const returnTo =
    "/organization/dvhs-csf?tab=csf-applications" +
    "&csf_import_type=application_responses" +
    "&csf_review_kind=membership_applications" +
    "&csf_review_term=33333333-3333-4333-8333-333333333333" +
    "&csf_review_cohort=44444444-4444-4444-8444-444444444444" +
    "&csf_application_queue=needs_review" +
    "&csf_application_q=Rana" +
    "&csf_application_sort=name";
  const resolved = resolveGoogleOAuthReturnRoute({
    purpose: "csf_import",
    returnTo,
    organizationSegments: ["dvhs-csf"],
  });

  assert.equal(resolved.allowlisted, true);
  assert.equal(resolved.returnTo, returnTo);
});

test("rejects unknown, duplicate, and malformed application import state", () => {
  const base =
    "/organization/dvhs-csf?tab=csf-applications&csf_import_type=application_responses";
  for (const returnTo of [
    `${base}&unknown=1`,
    `${base}&csf_application_q=one&csf_application_q=two`,
    `${base}&csf_review_term=not-a-uuid`,
    "/organization/dvhs-csf?tab=csf-applications",
  ]) {
    const resolved = resolveGoogleOAuthReturnRoute({
      purpose: "csf_import",
      returnTo,
      organizationSegments: ["dvhs-csf"],
    });
    assert.equal(resolved.allowlisted, false, returnTo);
  }
});

test("preserves the other canonical CSF surfaces that start a connection", () => {
  for (const tab of ["csf-meetings", "csf-partners"]) {
    const resolved = resolveGoogleOAuthReturnRoute({
      purpose: "csf_import",
      returnTo: `/organization/dvhs-csf?tab=${tab}`,
      organizationSegments: ["dvhs-csf"],
    });
    assert.equal(resolved.allowlisted, true, tab);
  }
});

test("refuses a same-origin path that is not a connect surface for the purpose", () => {
  const resolved = resolveGoogleOAuthReturnRoute({
    purpose: "csf_import",
    // Same origin and structurally valid, but not a surface that starts a CSF
    // connection -- previously this would have been honored.
    returnTo: "/account/settings",
    organizationSegments: ["dvhs-csf"],
  });

  assert.equal(resolved.allowlisted, false);
  assert.equal(
    resolved.returnTo,
    "/organization/dvhs-csf?tab=csf-applications&csf_import_type=application_responses",
  );
});

test("refuses another organization's surface even when the shape matches", () => {
  const resolved = resolveGoogleOAuthReturnRoute({
    purpose: "csf_import",
    returnTo:
      "/organization/some-other-chapter?tab=csf-applications&csf_import_type=application_responses",
    organizationSegments: ["dvhs-csf"],
  });

  assert.equal(resolved.allowlisted, false);
});

test("does not let one purpose borrow another purpose's return surface", () => {
  const calendarToCsf = resolveGoogleOAuthReturnRoute({
    purpose: "personal_calendar",
    returnTo:
      "/organization/dvhs-csf?tab=csf-applications&csf_import_type=application_responses",
    organizationSegments: ["dvhs-csf"],
  });
  assert.equal(calendarToCsf.allowlisted, false);
  assert.equal(calendarToCsf.returnTo, "/account/calendar");

  const csfToCalendarSettings = resolveGoogleOAuthReturnRoute({
    purpose: "csf_import",
    returnTo: "/organization/dvhs-csf/settings?section=calendar",
    organizationSegments: ["dvhs-csf"],
  });
  assert.equal(csfToCalendarSettings.allowlisted, false);
});

test("keeps the live Calendar, Sheets, and Reports return surfaces working", () => {
  const cases = [
    ["personal_calendar", "/account/calendar", []],
    ["personal_calendar", "/projects/33333333-3333-4333-8333-333333333333", []],
    [
      "organization_calendar",
      "/organization/acme/settings?section=calendar",
      ["acme"],
    ],
    [
      "organization_sheets",
      "/organization/acme/settings?section=sheets",
      ["acme"],
    ],
    ["organization_sheets", "/organization/acme?tab=reports", ["acme"]],
  ] as const;

  for (const [purpose, returnTo, segments] of cases) {
    const resolved = resolveGoogleOAuthReturnRoute({
      purpose,
      returnTo,
      organizationSegments: segments,
    });
    assert.equal(resolved.allowlisted, true, `${purpose} ${returnTo}`);
    assert.equal(resolved.returnTo, returnTo);
  }
});

test("rejects an off-origin or smuggled return target outright", () => {
  for (const returnTo of [
    "https://evil.example/organization/acme?tab=reports",
    "//evil.example/account/calendar",
    "/account/calendar?next=https://evil.example",
    "/organization/acme?tab=reports&extra=1",
  ]) {
    const resolved = resolveGoogleOAuthReturnRoute({
      purpose: "organization_sheets",
      returnTo,
      organizationSegments: ["acme"],
    });
    assert.equal(resolved.allowlisted, false, returnTo);
  }
});

test("falls back to each purpose's own surface", () => {
  assert.equal(
    getGoogleOAuthDefaultReturnRoute({
      purpose: "csf_import",
      organizationSegment: "dvhs-csf",
    }),
    "/organization/dvhs-csf?tab=csf-applications&csf_import_type=application_responses",
  );
  assert.equal(
    getGoogleOAuthDefaultReturnRoute({
      purpose: "personal_calendar",
      organizationSegment: null,
    }),
    "/account/calendar",
  );
});

// ---------------------------------------------------------------------------
// Intent validity: capabilities and bindings stay separate.
// ---------------------------------------------------------------------------

test("requires CSF import intent to bind an organization, plugin, and capability", () => {
  assert.equal(
    isValidGoogleOAuthIntent({
      organizationId: null,
      pluginKey: null,
      purpose: "csf_import",
      requestedCapability: null,
    }),
    false,
  );
  assert.equal(
    isValidGoogleOAuthIntent({
      organizationId: ORGANIZATION_ID,
      pluginKey: "dvhs-csf",
      purpose: "csf_import",
      requestedCapability: "import_members",
    }),
    true,
  );
});

test("refuses a plugin capability attached to a non-CSF purpose", () => {
  assert.equal(
    isValidGoogleOAuthIntent({
      organizationId: ORGANIZATION_ID,
      pluginKey: "dvhs-csf",
      purpose: "organization_sheets",
      requestedCapability: "import_members",
    }),
    false,
  );
});

// ---------------------------------------------------------------------------
// Route wiring that the lifecycle depends on.
// ---------------------------------------------------------------------------

test("the connect route sends a denial to the purpose allowlist, not a caller path", () => {
  const source = readFileSync(
    `${process.cwd()}/app/api/google/oauth/connect/route.ts`,
    "utf8",
  );

  const resolveIndex = source.indexOf("resolveGoogleOAuthReturnRoute({");
  const denialIndex = source.indexOf("if (!authorization.allowed)");

  // The allowlist is resolved before the authorization decision, so a denial
  // lands on the same audited surface a success would.
  assert.ok(resolveIndex > -1);
  assert.ok(denialIndex > resolveIndex);
  assert.match(source, /new URL\(allowlistedReturnTo, baseUrl\)/u);
  // The weaker same-origin normalizer must no longer decide a destination here.
  assert.doesNotMatch(source, /normalizeGoogleOAuthReturnTo/u);
  assert.doesNotMatch(source, /returnTo\.startsWith\("\/"\)/u);
});

test("the callback marks the code spent before presenting it to Google", () => {
  const source = readFileSync(
    `${process.cwd()}/app/api/google/oauth/callback/route.ts`,
    "utf8",
  );

  const markIndex = source.indexOf("await markGoogleOAuthAttemptExchanged(");
  const tokenExchangeIndex = source.indexOf(
    'fetch("https://oauth2.googleapis.com/token"',
  );

  assert.ok(markIndex > -1);
  assert.ok(
    tokenExchangeIndex > markIndex,
    "a spent authorization code must be recorded before it is presented",
  );
});

test("the connect route records a durable attempt before sending the browser to Google", () => {
  const source = readFileSync(
    `${process.cwd()}/app/api/google/oauth/connect/route.ts`,
    "utf8",
  );

  const recordIndex = source.indexOf("await beginGoogleOAuthAttempt(");
  const authorizeUrlIndex = source.indexOf(
    'new URL(\n      "https://accounts.google.com/o/oauth2/v2/auth",',
  );

  assert.ok(recordIndex > -1);
  assert.ok(authorizeUrlIndex > recordIndex);
  assert.match(source, /if \(!recorded\)/u);
  assert.match(source, /code_challenge_method", "S256"/u);
  assert.match(source, /resolveGoogleOAuthReturnRoute\(/u);
  // The verifier must never reach the authorization endpoint.
  assert.doesNotMatch(source, /code_verifier/u);
});

test("the callback claims the ledger before exchanging and sends the verifier only there", () => {
  const source = readFileSync(
    `${process.cwd()}/app/api/google/oauth/callback/route.ts`,
    "utf8",
  );

  const claimIndex = source.indexOf("await claimGoogleOAuthAttempt(");
  const tokenExchangeIndex = source.indexOf(
    'fetch("https://oauth2.googleapis.com/token"',
  );

  assert.ok(claimIndex > -1);
  assert.ok(tokenExchangeIndex > claimIndex);
  assert.match(source, /code_verifier: claim\.codeVerifier/u);
  // A duplicated callback must be answered without a second exchange.
  assert.match(source, /claim\.verdict === "already_settled"/u);
  assert.match(source, /claim\.verdict === "in_progress"/u);
  assert.ok(
    source.indexOf('claim.verdict === "already_settled"') < tokenExchangeIndex,
  );
});

test("both OAuth endpoints enforce the shared authorization before token storage", () => {
  const connectSource = readFileSync(
    `${process.cwd()}/app/api/google/oauth/connect/route.ts`,
    "utf8",
  );
  const callbackSource = readFileSync(
    `${process.cwd()}/app/api/google/oauth/callback/route.ts`,
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

test("a recorded success always names the connection it produced", () => {
  const source = readFileSync(
    `${process.cwd()}/app/api/google/oauth/callback/route.ts`,
    "utf8",
  );

  // The only `success: "connected"` settlement must carry a connection id, so
  // a null connection can never be recorded as a connected account.
  assert.match(
    source,
    /success: "connected",\n {6}connectionId: saveResult\.connectionId,/u,
  );
  assert.match(
    source,
    /connectionId: failed \? null : outcome\.connectionId,/u,
  );
});

test("the callback never leaks raw state, verifier, or provider text to the browser", () => {
  const source = readFileSync(
    `${process.cwd()}/app/api/google/oauth/callback/route.ts`,
    "utf8",
  );

  assert.doesNotMatch(source, /searchParams\.set\("state"/u);
  assert.doesNotMatch(source, /searchParams\.set\("detail"/u);
  // Only a bounded correlation code accompanies a failure.
  assert.match(
    source,
    /redirectUrl\.searchParams\.set\("code", result\.correlationId\)/u,
  );
});
