import { describe, expect, test } from "bun:test";

import { isRestartableAuthFlowError } from "./auth-flow-recovery";

describe("isRestartableAuthFlowError", () => {
  test.each([
    "pkce_code_verifier_not_found",
    "bad_code_verifier",
    "flow_state_expired",
  ])("classifies %s as restartable", (code) => {
    expect(isRestartableAuthFlowError({ code })).toBe(true);
  });

  test.each([
    "PKCE code verifier not found in storage",
    "code challenge does not match previously saved code verifier",
    "invalid flow state, flow state has expired",
    "State has already been used",
  ])("classifies provider message %s without exposing it", (message) => {
    expect(isRestartableAuthFlowError({ message })).toBe(true);
  });

  test("leaves unrelated provider failures on the normal error path", () => {
    expect(isRestartableAuthFlowError({ message: "invalid grant" })).toBe(
      false,
    );
    expect(isRestartableAuthFlowError(null)).toBe(false);
  });
});
