import assert from "node:assert/strict";
import test from "node:test";
import { readProjectActionSource } from "@/tests/support/project-action-source";

const source = readProjectActionSource();

test("anonymous confirmation resend is CAPTCHA-first, rate-limited, and token-bound", () => {
  const start = source.indexOf(
    "export async function resendAnonymousConfirmationEmail",
  );
  const end = source.indexOf(
    "export async function getWaiverDefinition",
    start,
  );
  const action = source.slice(start, end);

  assert.ok(
    action.indexOf("validateAnonymousSignupCaptcha") <
      action.indexOf('.from("anonymous_signups")'),
  );
  assert.match(action, /consume_api_rate_limit/u);
  assert.match(action, /p_window_seconds: 60/u);
  assert.match(action, /\?token=\$\{newToken\}/u);
  assert.match(action, /restorePreviousToken/u);
});

test("domain-restricted signup-only projects still require email ownership proof", () => {
  assert.match(
    source,
    /anonymousEmailConfirmationRequired\s*=\s*\n\s*!isSignupOnlyProject \|\| project\.restrict_to_org_domains === true/u,
  );
  assert.match(
    source,
    /confirmationRequired: anonymousEmailConfirmationRequired/u,
  );
  assert.match(
    source,
    /status: confirmationRequired \? "pending" : "approved"/u,
  );
  assert.match(
    source,
    /confirmed_at:\s*confirmationRequired\s*\?\s*null\s*:\s*new Date\(\)\.toISOString\(\)/u,
  );
});
