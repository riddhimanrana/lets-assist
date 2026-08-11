import { describe, expect, test } from "bun:test";

import { shouldRevokeGoogleOAuthGrant } from "./google-oauth-disconnect";

describe("Google OAuth disconnect revocation", () => {
  test("never revokes a potentially shared incremental grant", () => {
    expect(
      shouldRevokeGoogleOAuthGrant({
        requested: true,
        hasOtherActiveConnection: true,
      }),
    ).toBe(false);
  });

  test("revokes only when requested and the connection is the last active one", () => {
    expect(
      shouldRevokeGoogleOAuthGrant({
        requested: true,
        hasOtherActiveConnection: false,
      }),
    ).toBe(true);
    expect(
      shouldRevokeGoogleOAuthGrant({
        requested: false,
        hasOtherActiveConnection: false,
      }),
    ).toBe(false);
  });
});
