import { describe, expect, it } from "vitest";
import { buildAuthConfirmRedirectUrl, normalizeRedirectPath } from "./redirect-utils";

describe("signup redirect utils", () => {
  describe("normalizeRedirectPath", () => {
    it("accepts safe internal paths", () => {
      expect(normalizeRedirectPath("/anonymous/abc?link=1")).toBe("/anonymous/abc?link=1");
    });

    it("decodes encoded internal paths", () => {
      expect(normalizeRedirectPath("%2Fdashboard%3Ftab%3Dprofile")).toBe("/dashboard?tab=profile");
    });

    it("rejects external and protocol-relative redirects", () => {
      expect(normalizeRedirectPath("https://evil.example.com")).toBeNull();
      expect(normalizeRedirectPath("//evil.example.com")).toBeNull();
    });

    it("rejects empty values", () => {
      expect(normalizeRedirectPath("")).toBeNull();
      expect(normalizeRedirectPath("   ")).toBeNull();
      expect(normalizeRedirectPath(null)).toBeNull();
    });
  });

  describe("buildAuthConfirmRedirectUrl", () => {
    it("includes redirectAfterAuth only when redirect is valid", () => {
      const withRedirect = buildAuthConfirmRedirectUrl("https://lets-assist.test", "/anonymous/abc?link=1");
      const withoutRedirect = buildAuthConfirmRedirectUrl("https://lets-assist.test", "https://evil.example.com");

      expect(withRedirect).toContain("/auth/confirm");
      expect(withRedirect).toContain("redirectAfterAuth=%2Fanonymous%2Fabc%3Flink%3D1");
      expect(withoutRedirect).toBe("https://lets-assist.test/auth/confirm");
    });
  });
});