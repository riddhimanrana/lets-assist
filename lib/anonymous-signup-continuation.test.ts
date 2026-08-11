import assert from "node:assert/strict";
import test from "node:test";

import {
  createAnonymousSignupContinuation,
  verifyAnonymousSignupContinuation,
} from "./anonymous-signup-continuation";

const SECRET = "test-only-anonymous-continuation-secret-32-bytes";
const NOW = Date.UTC(2026, 6, 11, 12, 0, 0);
const IDENTITY = {
  anonymousSignupId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  email: "volunteer@example.com",
};

function createToken() {
  return createAnonymousSignupContinuation(IDENTITY, {
    now: NOW,
    secret: SECRET,
    nonce: "nonce-value-that-is-long-enough-for-validation-1234",
  });
}

test("accepts a fresh continuation bound to profile, project, and email", () => {
  assert.equal(
    verifyAnonymousSignupContinuation(createToken(), IDENTITY, {
      now: NOW + 1_000,
      secret: SECRET,
    }),
    true,
  );
});

test("rejects tampering and a different profile, project, or email", () => {
  const token = createToken();
  const [payload, signature] = token.split(".");
  assert.equal(
    verifyAnonymousSignupContinuation(`${payload}x.${signature}`, IDENTITY, {
      now: NOW + 1_000,
      secret: SECRET,
    }),
    false,
  );

  for (const identity of [
    { ...IDENTITY, anonymousSignupId: "33333333-3333-4333-8333-333333333333" },
    { ...IDENTITY, projectId: "33333333-3333-4333-8333-333333333333" },
    { ...IDENTITY, email: "attacker@example.com" },
  ]) {
    assert.equal(
      verifyAnonymousSignupContinuation(token, identity, {
        now: NOW + 1_000,
        secret: SECRET,
      }),
      false,
    );
  }
});

test("rejects expired continuations", () => {
  assert.equal(
    verifyAnonymousSignupContinuation(createToken(), IDENTITY, {
      now: NOW + 5 * 60 * 1_000,
      secret: SECRET,
    }),
    false,
  );
});
