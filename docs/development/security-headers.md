# Response security headers

Next.js applies the baseline in `lib/security/response-headers.ts` to every
platform response path. It blocks cross-origin framing, MIME sniffing, foreign
base URLs and object embeds. Same-origin frames remain available for certificate
printing and document previews. Referrers are omitted so links cannot forward
capability tokens or account query parameters to another page.

Camera scanning and map geolocation remain available to the application origin.
Unused microphone and device sensor capabilities are disabled. Hosted responses
include one year of HSTS. The policy does not request subdomain inheritance or
preload, and local servers do not emit HSTS.

This is an enforced baseline CSP. It does not yet restrict scripts, styles,
connections or iframe sources. A strict script policy needs a reviewed nonce or
hash strategy and browser coverage for Turnstile, Google Picker, maps, analytics,
PDF previews, microfrontends and static caching. Do not add `unsafe-inline` and
describe that as completed script protection. No raw CSP reports are collected;
they can contain private document URLs.

The Next config routing test checks public, authenticated, API and plugin paths.
Release verification must check effective hosted response headers and the
independent application deployment, whose own configuration can override the
platform response. Browser acceptance must cover QR camera access, map location,
Google authorization and Picker, challenge widgets, and certificate printing.

Reference: [Next.js response headers](https://nextjs.org/docs/app/api-reference/config/next-config-js/headers).
