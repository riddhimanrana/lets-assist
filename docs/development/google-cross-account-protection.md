# Google Cross-Account Protection (CAP) Setup

This app includes a CAP receiver endpoint at:

- `POST /api/security/google/cap`

The endpoint validates CAP (RISC) security event tokens with Google's RISC discovery + JWKS and then applies account-safety actions.

## Environment variables

Add these values to your local `.env.local` and production environment:

- `GOOGLE_CAP_ENVIRONMENT`
  - Required exact runtime binding: `local`, `development`, `preview`, or `production`.
  - On Vercel this must exactly match `VERCEL_ENV`; without `VERCEL_ENV`, only `local` is accepted.
- `GOOGLE_CAP_CLIENT_IDS`
  - Comma-separated OAuth client IDs allowed in CAP token `aud` claim.
  - Example: `123.apps.googleusercontent.com,456.apps.googleusercontent.com`

`GOOGLE_CAP_CLIENT_IDS` has no generic OAuth fallback. Configure a distinct
CAP audience/stream for each environment so a non-expiring Security Event Token
issued to one environment cannot execute in another. Missing, unknown, or
mismatched environment configuration fails closed with a retryable response.

## Receiver behavior

When CAP events are received for a linked Google account:

- `sessions-revoked` / `tokens-revoked`
  - Ends active sessions for the corresponding local account.
- `account-disabled`
  - Marks Google sign-in disabled for the local user.
  - If reason is `hijacking`, also ends active sessions.
- `account-enabled`
  - Re-enables Google sign-in for the local user.
- `account-credential-change-required`
  - Disables Google sign-in and ends active sessions until an administrator
    resolves the account-security condition.
- `verification`
  - Logged for stream verification checks.

The auth callback enforces this by denying Google OAuth sign-in when CAP has marked `google_signin_disabled` in auth `app_metadata`.

Supabase Auth does not expose admin sign-out by user UUID; its admin `signOut`
method requires that user's active JWT. CAP therefore uses the supported
`updateUserById` password-update path with an unpersisted random credential.
GoTrue performs global session logout in that transaction. Access JWTs remain
valid until their configured expiry, so sensitive authorization must continue
to validate current session/account state.

## Google Cloud / RISC registration checklist

1. Create service account with `roles/riscconfigs.admin`.
2. Enable the RISC API in the same GCP project as your Google Sign-In OAuth clients.
3. Register your CAP receiver URL (`https://<your-domain>/api/security/google/cap`) via `https://risc.googleapis.com/v1beta/stream:update`.
4. Include the verification event type and test with `stream:verify`.
5. Ensure receiver domain is in Authorized Domains on OAuth consent screen.

## Important notes

- CAP events are security-sensitive and should only be used for security / anti-fraud / session management purposes.
- CAP delivery endpoint must be HTTPS in production.
- Consider adding event `jti` deduplication storage if event volume grows.
