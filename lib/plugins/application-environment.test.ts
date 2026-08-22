import { describe, expect, test } from "bun:test";

import {
  resolveLocalPluginApplicationUrl,
  resolvePluginApplicationDeploymentBypassSecret,
  resolvePluginApplicationEnvironment,
} from "./application-environment";

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

describe("resolveLocalPluginApplicationUrl", () => {
  test("routes only the isolated fictional fixture lane to the local child", () => {
    expect(
      resolveLocalPluginApplicationUrl({
        CSF_LOCAL_FIXTURE_MODE: "1",
        PLUGIN_APPLICATION_LOCAL_URL: "http://127.0.0.1:3001",
      }),
    ).toBe("http://127.0.0.1:3001");
    expect(resolveLocalPluginApplicationUrl({})).toBeNull();
    expect(
      resolveLocalPluginApplicationUrl({
        CSF_LOCAL_FIXTURE_MODE: "1",
        PLUGIN_APPLICATION_LOCAL_URL: "https://example.com",
      }),
    ).toBeNull();
  });

  test("never enables the local child on a hosted deployment", () => {
    expect(
      resolveLocalPluginApplicationUrl({
        CSF_LOCAL_FIXTURE_MODE: "1",
        PLUGIN_APPLICATION_LOCAL_URL: "http://127.0.0.1:3001",
        VERCEL: "1",
        VERCEL_ENV: "preview",
      }),
    ).toBeNull();
  });
});

describe("resolvePluginApplicationDeploymentBypassSecret", () => {
  test("uses the same protection secret contract as deployment health probes", () => {
    expect(
      resolvePluginApplicationDeploymentBypassSecret({
        VERCEL_AUTOMATION_BYPASS_SECRET: " shared-protection-secret ",
      }),
    ).toBe("shared-protection-secret");
  });

  test("fails closed when the shared protection secret is absent", () => {
    expect(resolvePluginApplicationDeploymentBypassSecret({})).toBeUndefined();
    expect(
      resolvePluginApplicationDeploymentBypassSecret({
        VERCEL_AUTOMATION_BYPASS_SECRET: "   ",
      }),
    ).toBeUndefined();
  });
});
