# Turnstile boundary

Hosted anonymous signup and confirmation resend require both configured widget
keys and a successful Siteverify response. The server accepts only an exact
configured hostname and the action issued by that form. It rejects missing or
malformed responses, HTTP errors, redirects, expired or spent tokens, and
verification requests that exceed ten seconds. It never logs tokens or provider
response bodies. The anonymous continuation capability remains the separate,
signed authorization for additional slots in an already verified signup.

Production accepts the configured site origin and the two Let's Assist public
origins. Preview accepts its configured non-Production site origin and exact
Vercel deployment and branch hostnames. Request Host and forwarding headers do
not expand this list. Configure a separate Preview widget and matching server
secret in its provider environment. The source check prevents cross-environment
host acceptance; it does not create or rotate provider keys.

Local bypass requires loopback URLs for both the application and Supabase, no
Vercel environment marker, and no configured alternate remote Supabase URL.
Production-mode local builds also require the explicit bypass flag. A local
server targeting hosted data must use real verification. The browser follows
the same loopback requirement for the visible development indicator.

Auth signup and recovery continue to pass their challenge to Supabase Auth,
which performs its own Siteverify check. Do not verify those single-use tokens a
second time in the application. Anonymous signup uses `anonymous-signup`;
confirmation resend uses `anonymous-confirmation`.

Validation: `bun test lib/turnstile.test.ts lib/auth/secure-check.test.ts`.
Before release, exercise both forms with real staging widget keys, then inspect
provider hostname restrictions and Supabase Auth CAPTCHA configuration. No real
email or remote signup is required for the synthetic tests.

Reference: [Cloudflare server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
