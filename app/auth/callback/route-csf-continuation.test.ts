import { beforeEach, expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
let signOuts = 0;
mock.module("@/app/signup/request-origin", () => ({
  resolveAuthRedirectOrigin: () => "https://example.test",
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: null }),
      getUser: async () => ({
        error: null,
        data: {
          user: {
            id: "fictional-user",
            email: "fictional@example.test",
            app_metadata: {},
            user_metadata: {},
            created_at: "2020-01-01T00:00:00Z",
            identities: [{ provider: "google" }],
          },
        },
      }),
      signOut: async () => {
        signOuts++;
        return { error: null };
      },
    },
  }),
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return q;
    },
  }),
}));
mock.module("@/lib/security/google-cap", () => ({
  getGoogleSigninCapRestriction: () => ({
    disabled: true,
    reason: "Use password sign-in.",
  }),
}));
const { GET } = await import("./route");
beforeEach(() => {
  signOuts = 0;
});
async function destination(
  kind: "existing" | "disabled",
  continuation: string,
) {
  const url = new URL("https://example.test/auth/callback");
  url.searchParams.set("redirectAfterAuth", continuation);
  if (kind === "existing") {
    url.searchParams.set("error", "access_denied");
    url.searchParams.set("error_description", "email already exists");
  } else url.searchParams.set("code", "fictional-code");
  const response = await GET(new Request(url));
  return new URL(response.headers.get("location")!);
}
test("switching from Google to password sign-in retains the full class join continuation", async () => {
  const path =
    "/organization/chapter/plugins/dvhs-csf/connect/ABC234?from=invite#join";
  for (const kind of ["existing", "disabled"] as const) {
    const url = await destination(kind, path);
    expect(url.origin).toBe("https://example.test");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("redirect")).toBe(path);
    expect(url.searchParams.get("error")).toBe(
      kind === "existing" ? "email-password-exists" : "google-signin-disabled",
    );
  }
  expect(signOuts).toBe(1);
});
test("recovery never forwards external or protocol-relative redirects", async () => {
  for (const kind of ["existing", "disabled"] as const) {
    for (const path of [
      "https://other.test/steal",
      "//other.test/steal",
      "javascript:alert(1)",
    ]) {
      const url = await destination(kind, path);
      expect(url.origin).toBe("https://example.test");
      expect(url.searchParams.has("redirect")).toBe(false);
    }
  }
});
