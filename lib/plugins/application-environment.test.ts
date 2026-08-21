import { describe, expect, test } from "bun:test";

import { resolvePluginApplicationEnvironment } from "./application-environment";

describe("resolvePluginApplicationEnvironment", () => {
  test("maps the production target to the Production deployment ledger", () => {
    expect(
      resolvePluginApplicationEnvironment({ VERCEL_ENV: "production" }),
    ).toBe("production");
  });

  test("maps the hosted development branch to the Development ledger", () => {
    expect(
      resolvePluginApplicationEnvironment({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "development",
      }),
    ).toBe("development");
  });

  test("keeps pull request previews and local work out of hosted activation", () => {
    expect(
      resolvePluginApplicationEnvironment({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "codex/example",
      }),
    ).toBeNull();
    expect(resolvePluginApplicationEnvironment({})).toBeNull();
  });
});
