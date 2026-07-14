import assert from "node:assert/strict";
import test from "node:test";

import { passwordSchema } from "./password-policy";

test("password policy matches the Supabase letters-and-digits baseline", () => {
  assert.equal(passwordSchema.safeParse("letters-only").success, false);
  assert.equal(passwordSchema.safeParse("12345678").success, false);
  assert.equal(passwordSchema.safeParse("short1").success, false);
  assert.equal(passwordSchema.safeParse("secure-passphrase-42").success, true);
});
