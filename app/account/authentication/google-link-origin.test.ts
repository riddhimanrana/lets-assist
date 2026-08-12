import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `handleGoogleLink` starts a client-initiated `supabase.auth.linkIdentity`
 * OAuth flow. That call writes its PKCE verifier as a cookie on whatever
 * origin the browser is actually running on, so the `redirectTo` origin has
 * to match where `/auth/callback` will actually land the browser --
 * `resolveAuthRedirectOrigin`, which pins every hosted-deployment redirect
 * to the canonical configured origin regardless of the request. Building
 * `redirectTo` from the page's raw `window.location.origin` would let a
 * browser on a stale alias or any non-canonical host start the flow on one
 * origin and have the server finish it on another, stranding the verifier
 * cookie. See `resolveClientAuthOrigin` in `app/signup/request-origin.ts`
 * for the full policy this pins the client half of.
 */
describe("account authentication Google-linking redirect origin", () => {
  test("handleGoogleLink derives redirectTo from the shared client auth origin resolver", () => {
    const source = readFileSync(
      join(process.cwd(), "app/account/authentication/AuthenticationClient.tsx"),
      "utf8",
    );

    expect(source).toContain(
      'import { resolveClientAuthOrigin } from "@/app/signup/request-origin";',
    );
    expect(source).toContain(
      "redirectTo: `${resolveClientAuthOrigin()}/auth/callback?from=authentication`",
    );
    // The raw ambient page origin must not reach the OAuth redirectTo.
    expect(source).not.toMatch(/redirectTo:\s*`\$\{window\.location\.origin\}/u);
  });
});
