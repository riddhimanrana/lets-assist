import "server-only";

const GOOGLE_PICKER_WEB_CLIENT_ID =
  /^([1-9][0-9]{0,19})-[a-z0-9_-]{1,128}\.apps\.googleusercontent\.com$/u;

declare const googlePickerAppIdBrand: unique symbol;

export type GooglePickerAppId = string & {
  readonly [googlePickerAppIdBrand]: true;
};

export const GOOGLE_PICKER_CONFIGURATION_ERROR =
  "Google Picker is not configured correctly. Ask an administrator to verify that GOOGLE_CLIENT_ID is a Google OAuth web client ID for the same Google Cloud project as the Picker API key.";

export type GooglePickerAppIdResult =
  | { success: true; pickerAppId: GooglePickerAppId }
  | { success: false; error: string };

export type GooglePickerAccessTokenResult =
  | {
      success: true;
      accessToken: string;
      pickerAppId: GooglePickerAppId;
    }
  | { success: false; error: string };

export function resolveGooglePickerAppId(
  clientId: string | undefined = process.env.GOOGLE_CLIENT_ID,
): GooglePickerAppIdResult {
  const match = clientId?.match(GOOGLE_PICKER_WEB_CLIENT_ID);
  if (!match?.[1]) {
    return { success: false, error: GOOGLE_PICKER_CONFIGURATION_ERROR };
  }

  return {
    success: true,
    pickerAppId: match[1] as GooglePickerAppId,
  };
}

export function createGooglePickerAccessTokenResult(
  accessToken: string,
  pickerAppId: GooglePickerAppId,
): GooglePickerAccessTokenResult {
  return { success: true, accessToken, pickerAppId };
}
