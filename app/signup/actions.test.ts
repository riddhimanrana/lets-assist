import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Structural assertion: the signup action's catch block must return a generic
 * error message rather than the raw exception text. Internal exceptions
 * (config errors, unexpected network failures, etc.) must not be forwarded to
 * an unauthenticated caller, because the message text can reveal deployment
 * details such as which environment variables are missing.
 *
 * A full mock-based test for signup is deferred because the action's dependency
 * graph (auth, admin client, blacklist, PKCE origin) makes it test-setup
 * intensive. This source assertion is the minimum regression gate that ensures
 * the fix does not silently revert; runtime behavior is covered by the
 * `request-origin.test.ts` consumer-list assertion and the real integration
 * tests in CI.
 */
describe("signup action error masking", () => {
  test("the catch block returns generic copy, not the raw exception message", () => {
    const source = readFileSync(join(import.meta.dir, "actions.ts"), "utf8");

    // The catch block must NOT forward (error as Error).message to the caller.
    // Locate the catch block and verify its error return is a literal string,
    // not a dynamic expression derived from the caught value.
    const catchMatch = source.match(/\} catch \(error\) \{([\s\S]*?)\n\}/u);
    expect(catchMatch).not.toBeNull();
    const catchBody = catchMatch![1];

    // The raw message must not be forwarded.
    expect(catchBody).not.toContain("(error as Error).message");
    expect(catchBody).not.toContain("error.message");

    // A literal generic string must be returned.
    expect(catchBody).toContain(
      "Unable to complete registration. Please try again or contact support.",
    );
  });
});
