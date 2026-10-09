import { afterEach, describe, expect, test } from "bun:test";

import { cronTokens, isCronBearerAuthorized } from "./cron-auth";

const saved = {
  CRON_TOKEN: process.env.CRON_TOKEN,
  CRON_SECRET: process.env.CRON_SECRET,
};

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("cron bearer authorization", () => {
  test("accepts the Vercel Cron secret when a different CRON_TOKEN is set", () => {
    process.env.CRON_TOKEN = "github-token";
    process.env.CRON_SECRET = "vercel-secret";
    const tokens = cronTokens();

    expect(isCronBearerAuthorized("Bearer vercel-secret", tokens)).toBe(true);
    expect(isCronBearerAuthorized("Bearer github-token", tokens)).toBe(true);
  });

  test("accepts the Vercel Cron secret alongside a route worker token", () => {
    delete process.env.CRON_TOKEN;
    process.env.CRON_SECRET = "vercel-secret";
    const tokens = cronTokens("worker-token");

    expect(isCronBearerAuthorized("Bearer worker-token", tokens)).toBe(true);
    expect(isCronBearerAuthorized("Bearer vercel-secret", tokens)).toBe(true);
  });

  test("denies when no token is configured", () => {
    delete process.env.CRON_TOKEN;
    delete process.env.CRON_SECRET;

    expect(cronTokens(undefined)).toEqual([]);
    expect(isCronBearerAuthorized("Bearer anything", [])).toBe(false);
  });

  test("rejects wrong, missing, and malformed credentials", () => {
    const tokens = ["secret"];

    for (const header of [
      null,
      "",
      "secret",
      "Bearer",
      "Bearer ",
      "Bearer wrong",
      "Bearer secret ",
      " Bearer secret",
      "bearer secret",
      "Bearer secre",
      "Bearer secret\n",
    ]) {
      expect(isCronBearerAuthorized(header, tokens)).toBe(false);
    }
    expect(isCronBearerAuthorized("Bearer secret", tokens)).toBe(true);
  });
});
