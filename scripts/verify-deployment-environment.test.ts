import { describe, expect, test } from "bun:test";

import { assertDeploymentEnvironmentIsolation } from "./verify-deployment-environment.mjs";

describe("deployment environment isolation", () => {
  test("rejects the production project host in Vercel Preview", () => {
    expect(() =>
      assertDeploymentEnvironmentIsolation({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_SUPABASE_URL: "https://fotdmeakexgrkronxlof.supabase.co",
        EXPECTED_NON_PRODUCTION_SUPABASE_HOST:
          "fotdmeakexgrkronxlof.supabase.co",
      }),
    ).toThrow("expected Supabase host is production");
  });

  test("rejects a trailing-dot spelling of the production project host", () => {
    expect(() =>
      assertDeploymentEnvironmentIsolation({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_SUPABASE_URL: "https://fotdmeakexgrkronxlof.supabase.co.",
        EXPECTED_NON_PRODUCTION_SUPABASE_HOST:
          "fotdmeakexgrkronxlof.supabase.co.",
      }),
    ).toThrow("expected Supabase host is production");
  });

  test("rejects the production custom domain in custom non-production environments", () => {
    expect(() =>
      assertDeploymentEnvironmentIsolation({
        VERCEL_ENV: "staging",
        NEXT_PUBLIC_SUPABASE_URL: "https://api.lets-assist.com",
        EXPECTED_NON_PRODUCTION_SUPABASE_HOST: "api.lets-assist.com",
      }),
    ).toThrow("expected Supabase host is production");
  });

  test("accepts an isolated Preview branch project", () => {
    expect(() =>
      assertDeploymentEnvironmentIsolation({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
        EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
      }),
    ).not.toThrow();
  });

  test("accepts a fixed nonfunctional CI host only when it is exactly expected", () => {
    expect(() =>
      assertDeploymentEnvironmentIsolation({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_SUPABASE_URL: "https://ci-preview.invalid",
        EXPECTED_NON_PRODUCTION_SUPABASE_HOST: "ci-preview.invalid",
      }),
    ).not.toThrow();
  });

  test("allows approved production hosts and ordinary local builds", () => {
    expect(() =>
      assertDeploymentEnvironmentIsolation({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: "https://api.lets-assist.com",
      }),
    ).not.toThrow();

    expect(() =>
      assertDeploymentEnvironmentIsolation({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: "https://fotdmeakexgrkronxlof.supabase.co",
      }),
    ).not.toThrow();

    expect(() =>
      assertDeploymentEnvironmentIsolation({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).not.toThrow();
  });

  test("rejects a missing, insecure, or non-production host in Production", () => {
    expect(() =>
      assertDeploymentEnvironmentIsolation({
        VERCEL_ENV: "production",
      }),
    ).toThrow("without NEXT_PUBLIC_SUPABASE_URL");

    expect(() =>
      assertDeploymentEnvironmentIsolation({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: "http://api.lets-assist.com",
      }),
    ).toThrow("without an HTTPS Supabase URL");

    expect(() =>
      assertDeploymentEnvironmentIsolation({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
      }),
    ).toThrow("unapproved Supabase host");
  });

  test("rejects a missing or invalid Preview URL", () => {
    expect(() =>
      assertDeploymentEnvironmentIsolation({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_SUPABASE_URL: "https://preview-ref.supabase.co",
      }),
    ).toThrow("without an exact expected non-production Supabase host");

    expect(() =>
      assertDeploymentEnvironmentIsolation({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
        EXPECTED_NON_PRODUCTION_SUPABASE_HOST: "preview.example.test",
      }),
    ).toThrow("invalid NEXT_PUBLIC_SUPABASE_URL");
  });

  test("rejects an unexpected host even when both hosts are non-production", () => {
    expect(() =>
      assertDeploymentEnvironmentIsolation({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
        EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF: "zyxwvutsrqponmlkjihg",
      }),
    ).toThrow("unexpected Supabase host");
  });

  test("rejects disagreeing expected host and project-ref allowlists", () => {
    expect(() =>
      assertDeploymentEnvironmentIsolation({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
        EXPECTED_NON_PRODUCTION_SUPABASE_HOST:
          "abcdefghijklmnopqrst.supabase.co",
        EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF: "zyxwvutsrqponmlkjihg",
      }),
    ).toThrow("expected Supabase host and project ref disagree");
  });

  test("rejects HTTP Supabase endpoints in a Vercel deployment", () => {
    expect(() =>
      assertDeploymentEnvironmentIsolation({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_SUPABASE_URL: "http://preview.example.test",
        EXPECTED_NON_PRODUCTION_SUPABASE_HOST: "preview.example.test",
      }),
    ).toThrow("without an HTTPS Supabase URL");
  });
});
