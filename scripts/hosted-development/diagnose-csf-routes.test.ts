import { describe, expect, test } from "bun:test";
import {
  buildSyntheticAccounts,
  FIXTURE_MARKER,
  FIXTURE_ORGANIZATION_HANDLE,
} from "./csf-load-fixture.mjs";
import {
  parseDiagnosticResponse,
  passesDiagnosticBudgets,
  runDiagnosticRequests,
  validateDiagnosticIdentity,
  validateDiagnosticTarget,
} from "./diagnose-csf-routes.mjs";

describe("short hosted route diagnostic", () => {
  test("bounds requests and concurrency to the two fictional read routes", async () => {
    let active = 0;
    let peak = 0;
    const paths: string[] = [];
    const cycles: number[] = [];
    await runDiagnosticRequests(
      5,
      async (path: string) => {
        paths.push(path);
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return {
          body: "CSF hosted load fixture csf-cohort-hub-classes Split for review",
        };
      },
      (cycle: number) => cycles.push(cycle),
    );
    expect(peak).toBe(5);
    expect(active).toBe(0);
    expect(paths).toHaveLength(22);
    expect(new Set(paths)).toEqual(
      new Set([
        "/organization/csf-load-fixture?tab=csf-cohorts",
        "/organization/csf-load-fixture?tab=csf-applications",
      ]),
    );
    expect(cycles.filter((cycle) => cycle === 0)).toHaveLength(2);
    await expect(
      runDiagnosticRequests(
        100,
        () => {
          throw new Error("must not request");
        },
        () => {},
      ),
    ).rejects.toThrow("Diagnostic concurrency");
  });
  test("does not time a public landing page as an officer response", async () => {
    let observed = 0;
    await expect(
      runDiagnosticRequests(
        1,
        async () => ({ body: "Sign in" }),
        () => {
          observed += 1;
        },
      ),
    ).rejects.toThrow("intended fictional route");
    expect(observed).toBe(0);
  });
  const env = {
    SUPABASE_URL: "https://ocbuygudvarsuxijxhau.supabase.co",
    CSF_ROUTE_DIAGNOSTIC_CONFIRMATION: "diagnose:ocbuygudvarsuxijxhau",
    CSF_ROUTE_DIAGNOSTIC_SHA: "a".repeat(40),
  };
  test("requires the exact Development backend, confirmation, and release", () => {
    expect(validateDiagnosticTarget(env)).toBe(env.CSF_ROUTE_DIAGNOSTIC_SHA);
    for (const field of Object.keys(env))
      expect(() => validateDiagnosticTarget({ ...env, [field]: "" })).toThrow();
    expect(() =>
      validateDiagnosticTarget({
        ...env,
        SUPABASE_URL: "https://fotdmeakexgrkronxlof.supabase.co",
      }),
    ).toThrow();
  });
  test("refuses identities without trusted fictional officer metadata", () => {
    const account = buildSyntheticAccounts().officers[0];
    const user = {
      id: account.authUserId,
      email: account.email,
      app_metadata: {
        csf_hosted_load_fixture: true,
        organization_handle: FIXTURE_ORGANIZATION_HANDLE,
        fixture_contract: FIXTURE_MARKER,
        fixture_role: "officer",
      },
    };
    expect(() => validateDiagnosticIdentity(user, account)).not.toThrow();
    expect(() =>
      validateDiagnosticIdentity({ ...user, id: "other" }, account),
    ).toThrow();
    expect(() =>
      validateDiagnosticIdentity({ ...user, email: "other" }, account),
    ).toThrow();
    for (const field of Object.keys(user.app_metadata))
      expect(() =>
        validateDiagnosticIdentity(
          { ...user, app_metadata: { ...user.app_metadata, [field]: null } },
          account,
        ),
      ).toThrow();
    expect(() =>
      validateDiagnosticIdentity(
        { ...user, app_metadata: {}, user_metadata: user.app_metadata },
        account,
      ),
    ).toThrow();
  });
  test("measures the full response independently from first byte", () => {
    expect(
      parseDiagnosticResponse("fixture\nCSF_ROUTE_METRIC=200 1.1 5.4"),
    ).toEqual({
      body: "fixture",
      status: 200,
      firstByteMs: 1100,
      durationMs: 5400,
    });
    for (const value of [
      "302 1 2",
      "500 1 2",
      "200 NaN 2",
      "200 2 1",
      "200 -1 2",
      "200 1 Infinity",
    ])
      expect(() =>
        parseDiagnosticResponse(`private body\nCSF_ROUTE_METRIC=${value}`),
      ).toThrow();
    expect(() => parseDiagnosticResponse("private body")).toThrow(
      "Diagnostic response has no timing receipt.",
    );
  });
  test("fails the recorded slow routes and rejects incomplete samples", () => {
    const rows = ["classes", "applications"].map((route) => ({
      role: "officer",
      route,
      requests: 10,
      p95Ms: 2200,
      p99Ms: 2400,
      outcomes: { http_200: 10 },
    }));
    expect(passesDiagnosticBudgets(rows)).toBe(true);
    expect(
      passesDiagnosticBudgets([
        { ...rows[0], p95Ms: 5354.802, p99Ms: 6225.161 },
        rows[1],
      ]),
    ).toBe(false);
    expect(
      passesDiagnosticBudgets([
        rows[0],
        { ...rows[1], p95Ms: 2776.474, p99Ms: 2900 },
      ]),
    ).toBe(false);
    expect(passesDiagnosticBudgets([rows[0]])).toBe(false);
    expect(passesDiagnosticBudgets([rows[0], rows[0]])).toBe(false);
    expect(
      passesDiagnosticBudgets([{ ...rows[0], requests: 1 }, rows[1]]),
    ).toBe(false);
    expect(
      passesDiagnosticBudgets([
        { ...rows[0], outcomes: { http_200: 9, http_500: 1 } },
        rows[1],
      ]),
    ).toBe(false);
  });
});
