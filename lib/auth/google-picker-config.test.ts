import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const {
  GOOGLE_PICKER_CONFIGURATION_ERROR,
  createGooglePickerAccessTokenResult,
  resolveGooglePickerAppId,
} = await import("./google-picker-config");

describe("Google Picker configuration", () => {
  test("returns only the numeric Cloud project number for a valid web client ID", () => {
    const result = resolveGooglePickerAppId(
      "123456789012-fixtureclient.apps.googleusercontent.com",
    );

    expect(JSON.parse(JSON.stringify(result))).toEqual({
      success: true,
      pickerAppId: "123456789012",
    });
    expect(JSON.stringify(result)).not.toContain("fixtureclient");
  });

  test.each([
    undefined,
    "",
    "fixture-google-client-id.apps.googleusercontent.com",
    "123456789012.apps.googleusercontent.com",
    "123456789012-fixtureclient.example.com",
    "012345678901-fixtureclient.apps.googleusercontent.com",
    "123456789012-fixture client.apps.googleusercontent.com",
  ])("fails closed for missing or malformed client config", (clientId) => {
    expect(resolveGooglePickerAppId(clientId)).toEqual({
      success: false,
      error: GOOGLE_PICKER_CONFIGURATION_ERROR,
    });
  });

  test("builds the minimal access-token DTO without OAuth client or refresh data", () => {
    const appIdResult = resolveGooglePickerAppId(
      "123456789012-fixtureclient.apps.googleusercontent.com",
    );
    expect(appIdResult.success).toBeTrue();
    if (!appIdResult.success) return;

    const result = createGooglePickerAccessTokenResult(
      "fixture-access-token",
      appIdResult.pickerAppId,
    );

    expect(Object.keys(result).sort()).toEqual([
      "accessToken",
      "pickerAppId",
      "success",
    ]);
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      success: true,
      accessToken: "fixture-access-token",
      pickerAppId: "123456789012",
    });
    expect(result).not.toHaveProperty("clientId");
    expect(result).not.toHaveProperty("refreshToken");
  });
});
