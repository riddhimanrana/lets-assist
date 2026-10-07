import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  canBypassTurnstile,
  turnstileHostnames,
} from "./auth/turnstile-policy";
import { isSecureCheckBypassed } from "./auth/secure-check";
import { isTurnstileTokenRequired, verifyTurnstileToken } from "./turnstile";

const keys = [
  "NODE_ENV",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_REMOTE_SUPABASE_URL",
  "TURNSTILE_BYPASS",
  "TURNSTILE_SECRET_KEY",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
];
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const fetchMock = mock(
  async (_url: string | URL | Request, _init?: RequestInit) =>
    Response.json({
      success: true,
      hostname: "lets-assist.com",
      action: "anonymous-signup",
    }),
);
beforeEach(() => {
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, {
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    NEXT_PUBLIC_SITE_URL: "https://lets-assist.com",
    NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.co",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "synthetic-site-key",
    TURNSTILE_SECRET_KEY: "synthetic-secret",
  });
  fetchMock.mockClear();
  fetchMock.mockImplementation(async () =>
    Response.json({
      success: true,
      hostname: "lets-assist.com",
      action: "anonymous-signup",
    }),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe("Turnstile server boundary", () => {
  test("accepts only a successful challenge for the expected host and action", async () => {
    expect(
      await verifyTurnstileToken("synthetic-token", "anonymous-signup"),
    ).toBe(true);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    expect(options).toMatchObject({
      method: "POST",
      redirect: "error",
      cache: "no-store",
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect((options?.body as URLSearchParams).get("response")).toBe(
      "synthetic-token",
    );
  });
  for (const result of [
    { success: true, hostname: "attacker.example", action: "anonymous-signup" },
    {
      success: true,
      hostname: "lets-assist.com",
      action: "anonymous-confirmation",
    },
    { success: true },
    {
      success: "true",
      hostname: "lets-assist.com",
      action: "anonymous-signup",
    },
    { success: false, "error-codes": ["timeout-or-duplicate"] },
    null,
  ])
    test(`refuses an unbound or failed response ${JSON.stringify(result)}`, async () => {
      fetchMock.mockImplementation(async () => Response.json(result));
      expect(
        await verifyTurnstileToken("synthetic-token", "anonymous-signup"),
      ).toBe(false);
    });
  test("configuration gaps fail closed before any provider request", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    process.env.TURNSTILE_BYPASS = "true";
    expect(isTurnstileTokenRequired()).toBe(true);
    expect(
      await verifyTurnstileToken("synthetic-token", "anonymous-signup"),
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test("bounds input before contacting the provider", async () => {
    for (const token of ["", " ", "x".repeat(2049)])
      expect(await verifyTurnstileToken(token, "anonymous-signup")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test("refuses provider HTTP failures, malformed JSON and timeouts", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ success: true }, { status: 503 }),
    );
    expect(
      await verifyTurnstileToken("synthetic-token", "anonymous-signup"),
    ).toBe(false);
    fetchMock.mockImplementation(async () => new Response("invalid-json"));
    expect(
      await verifyTurnstileToken("synthetic-token", "anonymous-signup"),
    ).toBe(false);
    fetchMock.mockImplementation(async () => {
      throw new DOMException("Synthetic timeout", "TimeoutError");
    });
    expect(
      await verifyTurnstileToken("synthetic-token", "anonymous-signup"),
    ).toBe(false);
  });
});

test("local bypass requires both loopback services and no hosted or alternate remote configuration", () => {
  const local = {
    NODE_ENV: "production",
    TURNSTILE_BYPASS: "true",
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  };
  expect(canBypassTurnstile(local)).toBe(true);
  for (const changed of [
    { NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.co" },
    { NEXT_PUBLIC_SITE_URL: "https://lets-assist.com" },
    { VERCEL: "1" },
    { VERCEL_ENV: "preview" },
    { NEXT_PUBLIC_REMOTE_SUPABASE_URL: "https://synthetic.supabase.co" },
    { NEXT_PUBLIC_SUPABASE_URL: undefined },
  ])
    expect(canBypassTurnstile({ ...local, ...changed })).toBe(false);
  expect(
    isSecureCheckBypassed({
      nodeEnv: "development",
      bypass: "true",
      siteKey: undefined,
      siteUrl: local.NEXT_PUBLIC_SITE_URL,
      supabaseUrl: "https://synthetic.supabase.co",
    }),
  ).toBe(false);
});
test("Preview host binding excludes Production and accepts only exact trusted deployment names", () => {
  const hosts = turnstileHostnames({
    VERCEL_ENV: "preview",
    VERCEL_URL: "lets-assist-preview-team.vercel.app",
    VERCEL_BRANCH_URL: "lets-assist-git-development-team.vercel.app",
    NEXT_PUBLIC_SITE_URL: "https://lets-assist.com",
  });
  expect([...hosts]).toEqual([
    "lets-assist-preview-team.vercel.app",
    "lets-assist-git-development-team.vercel.app",
  ]);
  expect(
    turnstileHostnames({
      VERCEL_ENV: "preview",
      VERCEL_URL: "attacker.example/path",
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    }).size,
  ).toBe(0);
});
