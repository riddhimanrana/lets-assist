import { describe, expect, it } from "vitest";

import {
  buildMfaRedirectPath,
  deriveAuthenticatorAssurance,
  deriveMfaContinuationPath,
  getMfaFactorLabel,
  getVerifiedTotpFactors,
  normalizeAuthenticatorAssuranceLevel,
  resolvePostAuthRedirectPath,
  shouldPromptForMfaChallenge,
} from "./mfa";

describe("mfa helpers", () => {
  describe("resolvePostAuthRedirectPath", () => {
    it("falls back to /home when redirect is missing or unsafe", () => {
      expect(resolvePostAuthRedirectPath()).toBe("/home");
      expect(resolvePostAuthRedirectPath("https://evil.example.com")).toBe("/home");
    });

    it("keeps safe internal redirects", () => {
      expect(resolvePostAuthRedirectPath("/projects/abc?tab=settings")).toBe(
        "/projects/abc?tab=settings",
      );
    });
  });

  describe("buildMfaRedirectPath", () => {
    it("builds the bare MFA route when there is no safe continuation path", () => {
      expect(buildMfaRedirectPath()).toBe("/auth/mfa");
      expect(buildMfaRedirectPath("https://evil.example.com")).toBe("/auth/mfa");
    });

    it("preserves safe redirect targets for post-verification routing", () => {
      expect(buildMfaRedirectPath("/home?confirmed=true")).toBe(
        "/auth/mfa?redirect=%2Fhome%3Fconfirmed%3Dtrue",
      );
    });
  });

  describe("getVerifiedTotpFactors", () => {
    it("returns only verified TOTP factors", () => {
      expect(
        getVerifiedTotpFactors({
          totp: [
            {
              id: "verified-factor",
              factor_type: "totp",
              status: "verified",
              created_at: "2026-03-01T00:00:00.000Z",
            },
            {
              id: "pending-factor",
              factor_type: "totp",
              status: "unverified",
              created_at: "2026-03-02T00:00:00.000Z",
            },
          ],
        }),
      ).toEqual([
        {
          id: "verified-factor",
          factor_type: "totp",
          status: "verified",
          created_at: "2026-03-01T00:00:00.000Z",
        },
      ]);
    });
  });

  describe("getMfaFactorLabel", () => {
    it("prefers the friendly factor name and falls back gracefully", () => {
      expect(getMfaFactorLabel({ friendly_name: "My phone" })).toBe("My phone");
      expect(getMfaFactorLabel({ friendly_name: "   " })).toBe("Authenticator App");
      expect(getMfaFactorLabel({ friendly_name: null }, 1)).toBe("Authenticator App 2");
    });
  });

  describe("normalizeAuthenticatorAssuranceLevel", () => {
    it("keeps supported assurance levels and normalizes unknown ones to null", () => {
      expect(normalizeAuthenticatorAssuranceLevel("aal1")).toBe("aal1");
      expect(normalizeAuthenticatorAssuranceLevel("aal2")).toBe("aal2");
      expect(normalizeAuthenticatorAssuranceLevel("aal3")).toBeNull();
      expect(normalizeAuthenticatorAssuranceLevel(null)).toBeNull();
    });
  });

  describe("deriveAuthenticatorAssurance", () => {
    it("upgrades the next level when a verified authenticator exists", () => {
      expect(
        deriveAuthenticatorAssurance("aal1", {
          totp: [
            {
              id: "factor-1",
              factor_type: "totp",
              status: "verified",
            },
          ],
        }),
      ).toEqual({ currentLevel: "aal1", nextLevel: "aal2" });
    });

    it("keeps the current level when there is no verified authenticator", () => {
      expect(deriveAuthenticatorAssurance("aal1", { totp: [] })).toEqual({
        currentLevel: "aal1",
        nextLevel: "aal1",
      });
    });
  });

  describe("shouldPromptForMfaChallenge", () => {
    const verifiedTotpFactors = {
      totp: [
        {
          id: "factor-1",
          factor_type: "totp",
          status: "verified",
        },
      ],
    };

    it("requires MFA when the current session can be upgraded to aal2", () => {
      expect(
        shouldPromptForMfaChallenge(
          { currentLevel: "aal1", nextLevel: "aal2" },
          verifiedTotpFactors,
        ),
      ).toBe(true);
    });

    it("does not require MFA once the session is already aal2", () => {
      expect(
        shouldPromptForMfaChallenge(
          { currentLevel: "aal2", nextLevel: "aal2" },
          verifiedTotpFactors,
        ),
      ).toBe(false);
    });

    it("still requires MFA when assurance says the session can be upgraded even if factors could not be listed", () => {
      expect(
        shouldPromptForMfaChallenge(
          { currentLevel: "aal1", nextLevel: "aal2" },
          { totp: [] },
        ),
      ).toBe(true);
    });

    it("does not require MFA when there is no verified factor and no assurance upgrade available", () => {
      expect(
        shouldPromptForMfaChallenge(
          { currentLevel: "aal1", nextLevel: "aal1" },
          { totp: [] },
        ),
      ).toBe(false);
    });

    it("treats aal2 -> aal1 as a stale post-disable session and skips the challenge", () => {
      expect(
        shouldPromptForMfaChallenge(
          { currentLevel: "aal2", nextLevel: "aal1" },
          verifiedTotpFactors,
        ),
      ).toBe(false);
    });
  });

  describe("deriveMfaContinuationPath", () => {
    it("uses the login redirect when continuing from the login screen", () => {
      expect(
        deriveMfaContinuationPath({
          pathname: "/login",
          requestedRedirect: "/projects/create?draft=1",
        }),
      ).toBe("/projects/create?draft=1");
    });

    it("falls back to /home for restricted public routes", () => {
      expect(deriveMfaContinuationPath({ pathname: "/" })).toBe("/home");
      expect(deriveMfaContinuationPath({ pathname: "/faq" })).toBe("/home");
    });

    it("preserves internal protected routes and query strings", () => {
      expect(
        deriveMfaContinuationPath({
          pathname: "/account/authentication",
          search: "?success=linked",
        }),
      ).toBe("/account/authentication?success=linked");
    });
  });
});