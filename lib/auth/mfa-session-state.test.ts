import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { resolveMfaSessionState } from "./mfa-session-state";

const VERIFIED_TOTP = {
  all: [
    {
      id: "factor-1",
      factor_type: "totp",
      status: "verified",
    },
  ],
  totp: [
    {
      id: "factor-1",
      factor_type: "totp",
      status: "verified",
    },
  ],
};

test("uses Supabase currentLevel and nextLevel to require step-up", () => {
  assert.deepEqual(
    resolveMfaSessionState({
      assurance: { currentLevel: "aal1", nextLevel: "aal2" },
      factors: VERIFIED_TOTP,
    }),
    { requiresMfa: true, invalidUser: false, lookupError: null },
  );

  assert.deepEqual(
    resolveMfaSessionState({
      assurance: { currentLevel: "aal2", nextLevel: "aal2" },
      factors: VERIFIED_TOTP,
    }),
    { requiresMfa: false, invalidUser: false, lookupError: null },
  );
});

test("fails closed on lookup errors and recognizes a stale deleted user", () => {
  const lookupError = {
    message: "MFA service unavailable",
    code: "unexpected_failure",
    status: 503,
  };
  assert.deepEqual(
    resolveMfaSessionState({
      assurance: null,
      factors: null,
      assuranceError: lookupError,
    }),
    { requiresMfa: false, invalidUser: false, lookupError },
  );

  assert.deepEqual(
    resolveMfaSessionState({
      assurance: null,
      factors: null,
      factorsError: {
        message: "User from sub claim in JWT does not exist",
        status: 403,
      },
    }),
    { requiresMfa: false, invalidUser: true, lookupError: null },
  );
});

test("server auth reads the real Supabase assurance result once per auth branch", () => {
  const source = readFileSync(
    join(process.cwd(), "lib/supabase/auth-helpers.ts"),
    "utf8",
  );

  assert.match(source, /mfa\.getAuthenticatorAssuranceLevel\(\)/u);
  assert.doesNotMatch(source, /deriveAuthenticatorAssurance/u);
  assert.equal(
    [...source.matchAll(/await sessionRequiresMfa\(supabase\)/gu)].length,
    2,
  );
  assert.equal(
    [...source.matchAll(/if \(mfaState\.lookupError\)/gu)].length,
    2,
  );
  assert.ok(
    source.indexOf("if (mfaState.lookupError)") <
      source.indexOf("if (options.allowMfaPending && mfaState.requiresMfa)"),
  );
  assert.match(
    source,
    /if \(options\.allowMfaPending && mfaState\.requiresMfa\)[\s\S]*?return returnUser/u,
  );
});
