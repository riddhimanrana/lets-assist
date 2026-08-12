import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let requestHost = "lets-assist.com";
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

let blacklisted = false;
let blacklistQueryError: { message: string } | null = null;
let createClientCalls = 0;
let signUpCalls = 0;
let resendCalls = 0;
let oauthCalls = 0;
const verifierCookieHosts: string[] = [];
let signUpResult: {
  data: { user: { identities?: unknown[] } | null };
  error: { message: string } | null;
};
let resendError: { message: string; status?: number } | null = null;
let oauthError: { message: string } | null = null;
let capturedResendOptions: Record<string, string> | undefined;

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => {
    createClientCalls += 1;
    return {
      auth: {
        signUp: async () => {
          signUpCalls += 1;
          verifierCookieHosts.push(requestHost);
          return signUpResult;
        },
        resend: async (input: { options: Record<string, string> }) => {
          resendCalls += 1;
          verifierCookieHosts.push(requestHost);
          capturedResendOptions = input.options;
          return { error: resendError };
        },
        signInWithOAuth: async () => {
          oauthCalls += 1;
          verifierCookieHosts.push(requestHost);
          return {
            data: { url: "https://accounts.example/auth" },
            error: oauthError,
          };
        },
      },
    };
  },
}));

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      if (table !== "banned_emails")
        throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: blacklisted ? { email: "blocked@local.test" } : null,
              error: blacklistQueryError,
            }),
          }),
        }),
      };
    },
  }),
}));

const { resendVerificationEmail, signInWithGoogle, signup } =
  await import("./actions");

function signupForm(email = "person@local.test") {
  const form = new FormData();
  form.set("fullName", "Test Person");
  form.set("email", email);
  form.set("phone", "");
  form.set("password", "ValidPassword123!");
  return form;
}

beforeEach(() => {
  requestHost = "lets-assist.com";
  redirects.length = 0;
  blacklisted = false;
  blacklistQueryError = null;
  createClientCalls = 0;
  signUpCalls = 0;
  resendCalls = 0;
  oauthCalls = 0;
  verifierCookieHosts.length = 0;
  capturedResendOptions = undefined;
  signUpResult = {
    data: { user: { identities: [{ provider: "email" }] } },
    error: null,
  };
  resendError = null;
  oauthError = null;
  process.env.NEXT_PUBLIC_SITE_URL = "https://lets-assist.com";
  delete process.env.VERCEL_URL;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.E2E_TEST_MODE;
});

describe("signup enumeration resistance", () => {
  test("blacklisted, new, and existing addresses receive the same public success", async () => {
    blacklisted = true;
    const blockedResult = await signup(signupForm("blocked@local.test"));
    expect(signUpCalls).toBe(0);

    blacklisted = false;
    const newResult = await signup(signupForm("blocked@local.test"));
    expect(signUpCalls).toBe(1);

    signUpResult = { data: { user: { identities: [] } }, error: null };
    const existingResult = await signup(signupForm("blocked@local.test"));

    expect(blockedResult).toEqual(newResult);
    expect(existingResult).toEqual(newResult);
  });

  test("unexpected provider details are logged server-side but never returned", async () => {
    signUpResult = {
      data: { user: null },
      error: { message: "SMTP api key secret-provider-detail" },
    };

    const result = await signup(signupForm());
    expect(JSON.stringify(result)).not.toContain("secret-provider-detail");
    expect(result).toEqual({
      error: {
        server: [
          "Unable to complete registration. Please try again or contact support.",
        ],
      },
    });
  });
});

describe("signup resend enumeration resistance", () => {
  test("blacklist, provider success, and provider failure are indistinguishable", async () => {
    blacklisted = true;
    const blocked = await resendVerificationEmail("blocked@local.test");
    expect(resendCalls).toBe(0);

    blacklisted = false;
    const sent = await resendVerificationEmail("blocked@local.test");
    expect(resendCalls).toBe(1);

    resendError = {
      message: "recipient not found: secret-provider-detail",
      status: 400,
    };
    const providerFailure = await resendVerificationEmail("blocked@local.test");

    expect(blocked).toEqual(sent);
    expect(providerFailure).toEqual(sent);
    expect(JSON.stringify(providerFailure)).not.toContain(
      "secret-provider-detail",
    );
  });

  test("invalid input receives the same response without reaching provider or blacklist", async () => {
    const result = await resendVerificationEmail("not-an-email");
    expect(result).toEqual({
      success: true,
      message:
        "If this address can receive a verification email, one is on its way.",
    });
    expect(resendCalls).toBe(0);
  });
});

describe("signup PKCE producer host preflight", () => {
  test("a hosted alias redirects before clients, provider calls, or verifier cookies", async () => {
    requestHost = "stale-alias.example";

    await expect(signInWithGoogle()).rejects.toBeInstanceOf(RedirectSignal);
    expect(redirects).toEqual(["https://lets-assist.com/signup"]);
    expect(createClientCalls).toBe(0);
    expect(oauthCalls).toBe(0);
    expect(verifierCookieHosts).toHaveLength(0);
  });

  test("same-port loopback resend keeps verifier cookie and callback hosts equal", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3012";
    requestHost = "127.0.0.1:3012";

    await resendVerificationEmail("person@local.test", "captcha-token");

    expect(verifierCookieHosts).toEqual(["127.0.0.1:3012"]);
    expect(new URL(capturedResendOptions?.emailRedirectTo as string).host).toBe(
      verifierCookieHosts[0],
    );
  });
});
