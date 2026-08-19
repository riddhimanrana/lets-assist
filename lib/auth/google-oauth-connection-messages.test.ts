import assert from "node:assert/strict";
import test from "node:test";

import {
  GOOGLE_OAUTH_CALLBACK_PARAMS,
  readGoogleOAuthCallbackNotice,
} from "./google-oauth-connection-messages";

test("reports a successful connection without echoing provider values", () => {
  const notice = readGoogleOAuthCallbackNotice(
    "?success=connected&email=someone%40example.invalid",
  );

  assert.ok(notice);
  assert.equal(notice.tone, "success");
  assert.equal(notice.correlationId, null);
  assert.ok(!notice.message.includes("example.invalid"));
});

test("explains each distinct failure the callback can record", () => {
  const cases: Array<[string, "warning" | "error", boolean]> = [
    ["access_denied", "warning", true],
    ["missing_required_scope", "error", true],
    ["no_refresh_token", "error", true],
    ["expired_state", "warning", true],
    ["invalid_state", "error", true],
    ["connection_in_progress", "warning", false],
    ["attempt_not_started", "error", true],
    ["wrong_google_account", "error", true],
    ["unverified_google_account", "error", true],
    ["org_admin_required", "error", false],
    ["google_capability_required", "error", false],
    ["token_exchange_failed", "error", true],
    ["org_calendar_failed", "error", true],
  ];

  for (const [code, tone, canRetry] of cases) {
    const notice = readGoogleOAuthCallbackNotice(`?error=${code}`);
    assert.ok(notice, code);
    assert.equal(notice.tone, tone, code);
    assert.equal(notice.canRetry, canRetry, code);
    assert.ok(notice.message.length > 0, code);
    // The raw code must never become screen text.
    assert.ok(!notice.message.includes(code), code);
  }
});

test("never echoes an unrecognized or attacker-supplied error code", () => {
  const notice = readGoogleOAuthCallbackNotice(
    "?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E",
  );

  assert.ok(notice);
  assert.equal(notice.tone, "error");
  assert.ok(!notice.message.includes("script"));
  assert.equal(
    notice.message,
    "The connection did not finish. Nothing was changed.",
  );
});

test("surfaces a correlation code only when it has the expected shape", () => {
  assert.equal(
    readGoogleOAuthCallbackNotice("?error=invalid_state&code=ABCDEFGH01")
      ?.correlationId,
    "ABCDEFGH01",
  );
  assert.equal(
    readGoogleOAuthCallbackNotice("?error=invalid_state&code=../../etc/passwd")
      ?.correlationId,
    null,
  );
  assert.equal(
    readGoogleOAuthCallbackNotice("?error=invalid_state&code=short")
      ?.correlationId,
    null,
  );
});

test("returns nothing when the page was not reached from a callback", () => {
  assert.equal(readGoogleOAuthCallbackNotice("?tab=csf-imports"), null);
  assert.equal(readGoogleOAuthCallbackNotice(""), null);
});

test("lists every parameter a surface must strip after rendering", () => {
  assert.deepEqual(
    [...GOOGLE_OAUTH_CALLBACK_PARAMS],
    ["success", "error", "email", "code"],
  );
});
