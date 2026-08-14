import { describe, expect, test } from "bun:test";

import {
  extractWaiverSettingUpdates,
  getWaiverSettingsErrorMessage,
} from "./waiver-settings";
import {
  getWaiverConfigurationError,
  getWaiverSigningModeError,
  hasWaiverSigningMode,
} from "./waiver-validation";

describe("waiver setting extraction", () => {
  test("waiver switches leave the generic project update", () => {
    const updates: Record<string, unknown> = {
      title: "Beach cleanup",
      waiver_required: true,
      waiver_allow_upload: false,
      waiver_disable_esignature: false,
    };

    expect(extractWaiverSettingUpdates(updates)).toEqual({
      waiver_required: true,
      waiver_allow_upload: false,
      waiver_disable_esignature: false,
    });
    expect(updates).toEqual({ title: "Beach cleanup" });
  });

  test("an ordinary edit does not touch the waiver path at all", () => {
    const updates: Record<string, unknown> = { title: "Beach cleanup" };

    expect(extractWaiverSettingUpdates(updates)).toBeNull();
    expect(updates).toEqual({ title: "Beach cleanup" });
  });

  test("a non-boolean waiver value is stripped without being forwarded", () => {
    const updates: Record<string, unknown> = {
      waiver_required: "true",
      title: "Beach cleanup",
    };

    expect(extractWaiverSettingUpdates(updates)).toBeNull();
    expect(updates).toEqual({ title: "Beach cleanup" });
  });

  test("only the requested switches are forwarded", () => {
    const updates: Record<string, unknown> = { waiver_allow_upload: true };

    expect(extractWaiverSettingUpdates(updates)).toEqual({
      waiver_required: null,
      waiver_allow_upload: true,
      waiver_disable_esignature: null,
    });
  });
});

describe("waiver setting outcomes", () => {
  test("applied and no-op outcomes are not errors", () => {
    expect(getWaiverSettingsErrorMessage("updated")).toBeNull();
    expect(getWaiverSettingsErrorMessage("unchanged")).toBeNull();
  });

  test("every database refusal names what the organizer must fix", () => {
    for (const outcome of [
      "forbidden",
      "missing_waiver_source",
      "missing_storage_object",
      "missing_waiver_definition",
      "definition_source_mismatch",
      "definition_missing_signature_field",
      "no_signing_mode",
    ]) {
      const message = getWaiverSettingsErrorMessage(outcome);
      expect(message).toBeTruthy();
      expect(message).not.toBe(
        "This project's waiver settings could not be saved.",
      );
    }
  });

  test("an unknown outcome still fails closed with a generic message", () => {
    expect(getWaiverSettingsErrorMessage("something_new")).toBe(
      "This project's waiver settings could not be saved.",
    );
  });
});

describe("waiver signing mode", () => {
  test("a waiver with neither e-signature nor upload cannot be signed", () => {
    const unsignable = {
      waiverRequired: true,
      waiverDisableEsignature: true,
      waiverAllowUpload: false,
    };

    expect(hasWaiverSigningMode(unsignable)).toBe(false);
    expect(getWaiverSigningModeError(unsignable)).toMatch(/e-signatures/u);
  });

  test("either signing route on its own is enough", () => {
    expect(
      hasWaiverSigningMode({
        waiverRequired: true,
        waiverDisableEsignature: false,
        waiverAllowUpload: false,
      }),
    ).toBe(true);
    expect(
      hasWaiverSigningMode({
        waiverRequired: true,
        waiverDisableEsignature: true,
        waiverAllowUpload: true,
      }),
    ).toBe(true);
  });

  test("a project without a waiver is unaffected", () => {
    expect(
      getWaiverSigningModeError({
        waiverRequired: false,
        waiverDisableEsignature: true,
        waiverAllowUpload: false,
      }),
    ).toBeNull();
  });

  test("the combined check reports the missing PDF before the signing mode", () => {
    expect(
      getWaiverConfigurationError({
        waiverRequired: true,
        waiverDisableEsignature: true,
        waiverAllowUpload: false,
      }),
    ).toMatch(/waiver PDF is required/u);

    expect(
      getWaiverConfigurationError({
        waiverRequired: true,
        waiverPdfStoragePath: "project_waivers/p/source.pdf",
        waiverDisableEsignature: true,
        waiverAllowUpload: false,
      }),
    ).toMatch(/e-signatures/u);

    expect(
      getWaiverConfigurationError({
        waiverRequired: true,
        waiverPdfStoragePath: "project_waivers/p/source.pdf",
        waiverDisableEsignature: false,
        waiverAllowUpload: false,
      }),
    ).toBeNull();
  });
});
