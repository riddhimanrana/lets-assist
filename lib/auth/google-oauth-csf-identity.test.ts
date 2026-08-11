import { describe, expect, test } from "bun:test";

import {
  DVHS_CSF_GOOGLE_IMPORT_EMAIL,
  googleOAuthConnectionHasVerifiedCsfIdentity,
  googleOAuthConnectionIdentityMatches,
  isDvhsCsfGoogleImportBinding,
  validateGoogleOAuthCallbackIdentity,
} from "./google-oauth-csf-identity";

const csfBinding = {
  purpose: "csf_import",
  organizationId: "22222222-2222-4222-8222-222222222222",
  pluginKey: "dvhs-csf",
} as const;

describe("DVHS CSF Google identity policy", () => {
  test("recognizes only the exact organization-scoped CSF import binding", () => {
    expect(isDvhsCsfGoogleImportBinding(csfBinding)).toBeTrue();
    expect(
      isDvhsCsfGoogleImportBinding({
        ...csfBinding,
        purpose: "organization_sheets",
        pluginKey: null,
      }),
    ).toBeFalse();
  });

  test("matches the chapter address case-insensitively without accepting another account", () => {
    expect(DVHS_CSF_GOOGLE_IMPORT_EMAIL).toBe("dvhighcsf@gmail.com");
    expect(
      googleOAuthConnectionIdentityMatches(
        csfBinding,
        "  DVHighCSF@Gmail.com ",
      ),
    ).toBeTrue();
    expect(
      googleOAuthConnectionIdentityMatches(csfBinding, "officer@gmail.com"),
    ).toBeFalse();
  });

  test("requires Google's verified-email evidence before callback persistence", () => {
    expect(
      validateGoogleOAuthCallbackIdentity({
        binding: csfBinding,
        email: DVHS_CSF_GOOGLE_IMPORT_EMAIL,
        emailVerified: false,
      }),
    ).toEqual({ ok: false, error: "unverified_google_account" });
    expect(
      validateGoogleOAuthCallbackIdentity({
        binding: csfBinding,
        email: "officer@gmail.com",
        emailVerified: true,
      }),
    ).toEqual({ ok: false, error: "wrong_google_account" });
    expect(
      validateGoogleOAuthCallbackIdentity({
        binding: csfBinding,
        email: DVHS_CSF_GOOGLE_IMPORT_EMAIL,
        emailVerified: true,
      }),
    ).toEqual({ ok: true });
  });

  test("fails closed when a stored CSF binding has no durable verification evidence", () => {
    expect(
      googleOAuthConnectionHasVerifiedCsfIdentity(csfBinding, {
        connectionEmail: DVHS_CSF_GOOGLE_IMPORT_EMAIL,
        identityEmail: null,
        identityVerifiedAt: null,
      }),
    ).toBeFalse();
    expect(
      googleOAuthConnectionHasVerifiedCsfIdentity(csfBinding, {
        connectionEmail: DVHS_CSF_GOOGLE_IMPORT_EMAIL,
        identityEmail: DVHS_CSF_GOOGLE_IMPORT_EMAIL,
        identityVerifiedAt: "2026-08-09T23:00:00.000Z",
      }),
    ).toBeTrue();
    expect(
      googleOAuthConnectionHasVerifiedCsfIdentity(csfBinding, {
        connectionEmail: "officer@gmail.com",
        identityEmail: DVHS_CSF_GOOGLE_IMPORT_EMAIL,
        identityVerifiedAt: "2026-08-09T23:00:00.000Z",
      }),
    ).toBeFalse();
  });

  test("does not impose the chapter policy on unrelated Google purposes", () => {
    const personalCalendar = {
      purpose: "personal_calendar",
      organizationId: null,
      pluginKey: null,
    } as const;
    expect(
      googleOAuthConnectionIdentityMatches(
        personalCalendar,
        "someone@example.test",
      ),
    ).toBeTrue();
    expect(
      validateGoogleOAuthCallbackIdentity({
        binding: personalCalendar,
        email: "someone@example.test",
        emailVerified: false,
      }),
    ).toEqual({ ok: true });
  });
});
