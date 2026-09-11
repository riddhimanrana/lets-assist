import { expect, mock, test } from "bun:test";
import type { NextRequest } from "next/server";
mock.module("server-only", () => ({}));
let captured = "";
mock.module("next/navigation", () => ({
  redirect: (url: string) => {
    captured = url;
    throw new Error("test-redirect");
  },
}));
mock.module("@/app/signup/request-origin", () => ({
  resolveAuthRedirectOrigin: () => "https://example.test",
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => ({
        error: {
          code: "pkce_code_verifier_not_found",
          message: "PKCE code verifier not found",
        },
      }),
    },
  }),
}));
const { GET } = await import("./route");
test("expired and cross-device verification routes preserve only a safe class continuation", async () => {
  const path = "/organization/chapter/plugins/dvhs-csf/connect/ABC234";
  for (const continuation of [path, "https://other.test/steal"]) {
    const url = new URL(
      "https://example.test/auth/confirm?code=fictional&type=signup&email=fictional%40example.test",
    );
    url.searchParams.set("redirectAfterAuth", continuation);
    await expect(GET(new Request(url) as NextRequest)).rejects.toThrow(
      "test-redirect",
    );
    const result = new URL(captured);
    expect(result.pathname).toBe("/auth/email-expired");
    expect(result.searchParams.get("redirectAfterAuth")).toBe(
      continuation === path ? path : null,
    );
  }
});
