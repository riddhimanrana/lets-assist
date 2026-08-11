import type { GoogleOAuthConnectionPurpose } from "./google-oauth-state";

export type GoogleOAuthConnectionBindingExpectation = {
  purpose: GoogleOAuthConnectionPurpose;
  organizationId: string | null;
  pluginKey: string | null;
};
