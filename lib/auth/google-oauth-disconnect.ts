export type GoogleOAuthRemoteRevocationState =
  | "not_requested"
  | "skipped_shared_grant"
  | "revoked"
  | "failed";

export function shouldRevokeGoogleOAuthGrant(input: {
  requested: boolean;
  hasOtherActiveConnection: boolean;
}) {
  return input.requested && !input.hasOtherActiveConnection;
}
