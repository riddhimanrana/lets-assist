import { describe, expect, mock, test, beforeEach } from "bun:test";

mock.module("server-only", () => ({}));

let requestHost = "localhost:3000";
const redirects: string[] = [];

class RedirectSignal extends Error {}

mock.module("next/headers", () => ({
  headers: async () => new Headers({ host: requestHost }),
}));
mock.module("next/navigation", () => ({
  redirect: (destination: string) => {
    redirects.push(destination);
    throw new RedirectSignal(destination);
  },
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
  requestHost = "localhost:3000";
  redirects.length = 0;
  capturedResetEmail = undefined;
  capturedResetOptions = undefined;
  supabaseResetError = null;
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  delete process.env.VERCEL_URL;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
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
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    delete process.env.NEXT_PUBLIC_SITE_URL;

    await expect(
      requestPasswordReset(makeFormData({ email: "user@example.com" })),
    ).rejects.toThrow(/No valid site origin is configured/u);
    expect(capturedResetEmail).toBeUndefined();
  });

  test("a stale hosted alias redirects before the recovery provider writes a verifier", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://lets-assist.com";
    requestHost = "stale.example";

    await expect(
      requestPasswordReset(makeFormData({ email: "user@example.com" })),
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(redirects).toEqual(["https://lets-assist.com/reset-password"]);
    expect(capturedResetEmail).toBeUndefined();
  });

  test("same-port loopback recovery uses the verifier cookie's host", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3012";
    requestHost = "127.0.0.1:3012";

    await requestPasswordReset(makeFormData({ email: "user@example.com" }));

    expect(new URL(capturedResetOptions?.redirectTo as string).origin).toBe(
      "http://127.0.0.1:3012",
    );
  });
});
