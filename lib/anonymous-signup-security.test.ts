import { describe, expect, it } from "vitest";

import {
  shouldRenderTurnstileWidget,
  shouldRequireAnonymousSignupCaptcha,
} from "./anonymous-signup-security";

describe("anonymous signup security policy", () => {
  describe("shouldRequireAnonymousSignupCaptcha", () => {
    it("requires captcha for a new anonymous profile", () => {
      expect(
        shouldRequireAnonymousSignupCaptcha({
          hasExistingAnonymousProfile: false,
          skipConfirmationEmail: false,
        }),
      ).toBe(true);
    });

    it("requires captcha for normal single-slot reuse of an existing anonymous profile", () => {
      expect(
        shouldRequireAnonymousSignupCaptcha({
          hasExistingAnonymousProfile: true,
          skipConfirmationEmail: false,
        }),
      ).toBe(true);
    });

    it("allows follow-up multi-slot requests to skip captcha only when a profile already exists", () => {
      expect(
        shouldRequireAnonymousSignupCaptcha({
          hasExistingAnonymousProfile: true,
          skipConfirmationEmail: true,
        }),
      ).toBe(false);
    });

    it("still requires captcha when skipConfirmationEmail is spoofed for a missing profile", () => {
      expect(
        shouldRequireAnonymousSignupCaptcha({
          hasExistingAnonymousProfile: false,
          skipConfirmationEmail: true,
        }),
      ).toBe(true);
    });
  });

  describe("shouldRenderTurnstileWidget", () => {
    it("renders when a site key exists and bypass is disabled", () => {
      expect(
        shouldRenderTurnstileWidget({
          siteKey: "site-key",
          bypass: "false",
        }),
      ).toBe(true);
    });

    it("hides the widget when the site key is missing", () => {
      expect(
        shouldRenderTurnstileWidget({
          siteKey: undefined,
          bypass: "false",
        }),
      ).toBe(false);
    });

    it("hides the widget when bypass mode is enabled", () => {
      expect(
        shouldRenderTurnstileWidget({
          siteKey: "site-key",
          bypass: "true",
        }),
      ).toBe(false);
    });
  });
});
