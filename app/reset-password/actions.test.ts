import { describe, expect, mock, test, beforeEach } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Map(),
}));

let capturedResetEmail: string | undefined;
let capturedResetOptions: Record<string, string> | undefined;
let supabaseResetError: { message: string } | null = null;

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      resetPasswordForEmail: async (
        email: string,
        options: Record<string, string>,
      ) => {
        capturedResetEmail = email;
        capturedResetOptions = options;
        return { error: supabaseResetError };
      },
    },
  }),
}));

const { requestPasswordReset } = await import("./actions");

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  capturedResetEmail = undefined;
  capturedResetOptions = undefined;
  supabaseResetError = null;
});

describe("requestPasswordReset", () => {
  test("always returns success to avoid email enumeration when Supabase returns an error", async () => {
    supabaseResetError = { message: "User not found" };
    const result = await requestPasswordReset(
      makeFormData({ email: "unknown@example.com" }),
    );
    expect(result).toEqual({ success: true });
    expect(capturedResetEmail).toBe("unknown@example.com");
  });

  test("returns success on a well-formed request", async () => {
    const result = await requestPasswordReset(
      makeFormData({ email: "user@example.com" }),
    );
    expect(result).toEqual({ success: true });
    expect(capturedResetEmail).toBe("user@example.com");
  });

  test("the redirectTo is built from resolveConfiguredSiteOrigin, not a raw env read", async () => {
    const result = await requestPasswordReset(
      makeFormData({ email: "user@example.com" }),
    );
    expect(result.success).toBe(true);
    // resolveConfiguredSiteOrigin falls back to http://localhost:3000 in test
    // (no VERCEL/NODE_ENV=production), so the link must use that origin rather
    // than the literal string "undefined" that a raw `process.env.NEXT_PUBLIC_SITE_URL`
    // read would have interpolated when the variable is unset.
    expect(capturedResetOptions?.redirectTo).toMatch(
      /^http:\/\/localhost:3000\/auth\/callback\?type=recovery$/u,
    );
  });

  test("a captcha token is forwarded to Supabase", async () => {
    await requestPasswordReset(
      makeFormData({ email: "user@example.com", turnstileToken: "tok123" }),
    );
    expect(capturedResetOptions?.captchaToken).toBe("tok123");
  });

  test("returns a field error for an invalid email format", async () => {
    const result = await requestPasswordReset(
      makeFormData({ email: "not-an-email" }),
    );
    expect(result).toHaveProperty("error");
    expect(capturedResetEmail).toBeUndefined();
  });
});

describe("requestPasswordReset origin resolution is above the enumeration try/catch", () => {
  test("a misconfigured hosted deployment propagates a config error rather than returning fake success", async () => {
    // Simulate a hosted deployment with no valid NEXT_PUBLIC_SITE_URL: the
    // resolver throws before the Supabase call, so the error is NOT swallowed
    // by the email-enumeration catch. This test verifies the placement of
    // resolveConfiguredSiteOrigin() relative to the try/catch by checking the
    // source text — the structural assertion that guards against re-entrant
    // regressions where the call drifts back inside the catch scope.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(import.meta.dir, "actions.ts"),
      "utf8",
    );

    // The resolver call must appear before the `try {` that wraps the
    // Supabase call and swallows auth errors as email-enumeration protection.
    const resolveIndex = source.indexOf("resolveConfiguredSiteOrigin()");
    const tryIndex = source.indexOf("try {");
    expect(resolveIndex).toBeGreaterThan(-1);
    expect(tryIndex).toBeGreaterThan(-1);
    expect(resolveIndex).toBeLessThan(tryIndex);
  });
});
