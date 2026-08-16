import { describe, expect, test } from "bun:test";

import { signupContinuationDescription } from "./signup-continuation-copy";

/**
 * A student arriving from a CSF class invitation was told they were finishing
 * a "project signup" they had never started, because any redirect at all
 * produced that sentence.
 */
describe("signupContinuationDescription", () => {
  test("keeps the project wording only for an actual project", () => {
    expect(signupContinuationDescription("/projects/abc-123")).toBe(
      "Sign up to continue with your project signup",
    );
  });

  test("does not claim a project signup for a CSF class invitation", () => {
    const copy = signupContinuationDescription(
      "/organization/dvhs-csf/plugins/dvhs-csf/connect/S26-2028",
    );
    expect(copy).not.toContain("project");
    expect(copy).toBe("Sign up to continue where you left off");
  });

  test("falls back to the plain account wording with no redirect", () => {
    for (const value of [undefined, null, "", "   "]) {
      expect(signupContinuationDescription(value)).toBe(
        "Enter your details below to create your account",
      );
    }
  });

  test("a lookalike path is not treated as a project", () => {
    // "/projectsomething" is not "/projects/<id>".
    expect(signupContinuationDescription("/projectsomething")).toBe(
      "Sign up to continue where you left off",
    );
  });
});
