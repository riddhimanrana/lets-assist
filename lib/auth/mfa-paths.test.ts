import assert from "node:assert/strict";
import test from "node:test";

import { isMfaProtectedPath } from "./mfa-paths";

test("covers organization and project surfaces", () => {
  assert.equal(isMfaProtectedPath("/organization"), true);
  assert.equal(isMfaProtectedPath("/organization/acme"), true);
  assert.equal(isMfaProtectedPath("/projects"), true);
  assert.equal(isMfaProtectedPath("/projects/123"), true);
  assert.equal(isMfaProtectedPath("/trusted-member"), true);
});

test("does not flag public informational routes", () => {
  assert.equal(isMfaProtectedPath("/faq"), false);
  assert.equal(isMfaProtectedPath("/login"), false);
  assert.equal(isMfaProtectedPath("/home"), false);
});