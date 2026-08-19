import { afterEach, describe, expect, test } from "bun:test";

import {
  guardDevelopmentProviderSend,
  shouldUseMailpitTransport,
} from "./email";

/**
 * Transport selection is the boundary between "a test mailed nobody" and "a test
 * mailed a real person from a Preview deployment".
 *
 * The regression this file exists for: the environment fallback keyed off
 * NODE_ENV. Next.js sets NODE_ENV=production for EVERY built deployment,
 * Preview included, so `NODE_ENV !== "production"` was false on Preview and the
 * Resend transport was selected. With EMAIL_TRANSPORT unset -- which is how the
 * project was actually configured -- every transactional mail sent from the
 * `development` deployment went to its real recipient.
 *
 * NODE_ENV cannot distinguish Preview from Production and must never be the
 * discriminator here. VERCEL_ENV can, and is.
 *
 * Every case below therefore pins NODE_ENV=production, because that is the value
 * a real Vercel build has in all three environments. A test that varied NODE_ENV
 * would pass against the broken implementation and prove nothing.
 */

const ENV_KEYS = [
  "EMAIL_TRANSPORT",
  "VERCEL_ENV",
  "NODE_ENV",
  "RESEND_DEV_FROM_DOMAIN",
  "RESEND_DEV_RECIPIENT_ALLOWLIST",
] as const;
const originals = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of originals) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("shouldUseMailpitTransport environment fallback", () => {
  test("a Preview build does NOT select Resend, even though NODE_ENV is production", () => {
    // The exact shape of a Vercel Preview deployment of `development`.
    setEnv({ VERCEL_ENV: "preview", NODE_ENV: "production" });

    expect(shouldUseMailpitTransport()).toBe(true);
  });

  test("a Production build selects Resend", () => {
    setEnv({ VERCEL_ENV: "production", NODE_ENV: "production" });

    expect(shouldUseMailpitTransport()).toBe(false);
  });

  test("Vercel's own 'development' environment does not select Resend", () => {
    setEnv({ VERCEL_ENV: "development", NODE_ENV: "production" });

    expect(shouldUseMailpitTransport()).toBe(true);
  });

  test("off-Vercel with a production build does not select Resend", () => {
    // `next start` locally, or a CI job running a production build. There is no
    // VERCEL_ENV, and nothing here should be able to reach a real inbox.
    setEnv({ NODE_ENV: "production" });

    expect(shouldUseMailpitTransport()).toBe(true);
  });

  test("VERCEL_ENV is compared case- and whitespace-insensitively", () => {
    setEnv({ VERCEL_ENV: "  Production  ", NODE_ENV: "production" });

    expect(shouldUseMailpitTransport()).toBe(false);
  });
});

describe("shouldUseMailpitTransport explicit override", () => {
  test("EMAIL_TRANSPORT=resend still wins on Preview", () => {
    // The override is the deliberate escape hatch for anyone who genuinely wants
    // live sends from a non-production deployment. It must keep working, or the
    // fix above would make that impossible.
    setEnv({
      EMAIL_TRANSPORT: "resend",
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
    });

    expect(shouldUseMailpitTransport()).toBe(false);
  });

  test("EMAIL_TRANSPORT=mailpit still wins on Production", () => {
    setEnv({
      EMAIL_TRANSPORT: "mailpit",
      VERCEL_ENV: "production",
      NODE_ENV: "production",
    });

    expect(shouldUseMailpitTransport()).toBe(true);
  });

  test("an unrecognised EMAIL_TRANSPORT falls through to the environment", () => {
    // Not "resend", so it must not be treated as permission to send live.
    setEnv({
      EMAIL_TRANSPORT: "smtp",
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
    });

    expect(shouldUseMailpitTransport()).toBe(true);
  });
});

describe("Development Resend recipient guard", () => {
  test("requires the dedicated sender domain on Preview", () => {
    setEnv({ VERCEL_ENV: "preview", EMAIL_TRANSPORT: "resend" });

    expect(
      guardDevelopmentProviderSend({
        from: "Let's Assist <development@dev-mail.lets-assist.com>",
        to: "delivered@resend.dev",
      }),
    ).toEqual({
      allowed: false,
      code: "development_sender_domain_missing",
    });
  });

  test("allows Resend test addresses from the dedicated domain", () => {
    setEnv({
      VERCEL_ENV: "preview",
      EMAIL_TRANSPORT: "resend",
      RESEND_DEV_FROM_DOMAIN: "dev-mail.lets-assist.com",
    });

    expect(
      guardDevelopmentProviderSend({
        from: "Let's Assist Development <development@dev-mail.lets-assist.com>",
        to: [
          "delivered@resend.dev",
          "bounced+synthetic-1@resend.dev",
          "complained@resend.dev",
          "suppressed@resend.dev",
        ],
      }),
    ).toEqual({ allowed: true });
  });

  test("blocks non-test recipients unless explicitly allowlisted", () => {
    setEnv({
      VERCEL_ENV: "preview",
      EMAIL_TRANSPORT: "resend",
      RESEND_DEV_FROM_DOMAIN: "dev-mail.lets-assist.com",
      RESEND_DEV_RECIPIENT_ALLOWLIST: "qa-owner@example.test",
    });

    expect(
      guardDevelopmentProviderSend({
        from: "development@dev-mail.lets-assist.com",
        to: "student@example.org",
      }),
    ).toEqual({
      allowed: false,
      code: "development_recipient_blocked",
    });
    expect(
      guardDevelopmentProviderSend({
        from: "development@dev-mail.lets-assist.com",
        to: "QA-OWNER@example.test",
      }),
    ).toEqual({ allowed: true });
  });

  test("does not apply Preview policy to Production", () => {
    setEnv({ VERCEL_ENV: "production", EMAIL_TRANSPORT: "resend" });

    expect(
      guardDevelopmentProviderSend({
        from: "projects@notifications.lets-assist.com",
        to: "member@example.org",
      }),
    ).toEqual({ allowed: true });
  });
});
