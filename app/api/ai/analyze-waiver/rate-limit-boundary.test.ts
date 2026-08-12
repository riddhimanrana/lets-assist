import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const route = readFileSync(join(import.meta.dir, "route.ts"), "utf8");

describe("waiver analysis route cost and error boundary", () => {
  test("authenticates and consumes durable quota before parsing the upload", () => {
    const auth = route.indexOf("getAuthUser({ sensitive: true })");
    const quota = route.indexOf("await consumeAnalyzeWaiverQuota(");
    const formData = route.indexOf("await request.formData()");
    const provider = route.indexOf("await generateText({");

    expect(auth).toBeGreaterThan(-1);
    expect(quota).toBeGreaterThan(auth);
    expect(formData).toBeGreaterThan(quota);
    expect(provider).toBeGreaterThan(formData);
  });

  test("fails closed with bounded retry guidance", () => {
    const authError = route.indexOf("if (authResult.error)");
    const missingUser = route.indexOf("if (!authResult.user)");

    expect(authError).toBeGreaterThan(-1);
    expect(missingUser).toBeGreaterThan(authError);
    expect(route).toContain("Waiver analysis rate-limit check failed");
    expect(route).toContain("{ status: 503 }");
    expect(route).toContain("if (!quota.allowed)");
    expect(route).toContain("status: 429");
    expect(route).toContain('headers: { "Retry-After"');
  });

  test("keeps the local E2E bypass non-production-only", () => {
    expect(route).toContain('process.env.NODE_ENV !== "production"');
    expect(route).toContain('process.env.ENABLE_E2E_AUTH_BYPASS === "true"');
    expect(route.indexOf("if (!isE2EBypassEnabled)")).toBeLessThan(
      route.indexOf("await consumeAnalyzeWaiverQuota("),
    );
  });

  test("does not return or log raw exception messages", () => {
    const catchBoundary = route.slice(route.lastIndexOf("} catch (error)"));

    expect(catchBoundary).not.toContain("error.message");
    expect(catchBoundary).not.toContain("details:");
    expect(catchBoundary).toContain("errorClass:");
    expect(route).not.toContain(
      '"Vision fallback failed, continuing without fallback fields:",',
    );
    expect(route).not.toContain("console.warn(fallbackError)");
  });
});
