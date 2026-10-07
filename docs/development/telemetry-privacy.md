# Telemetry privacy

Browser analytics uses an explicit public-page contract in
`lib/analytics-privacy.ts`. The SDK initializes only on the HTTPS Production
hostname in a production build. Development, localhost, and Preview capture
are disabled.

Only public pageviews leave the browser. Authentication, account, dashboard,
organization workspaces, invitations, certificates, and unknown routes are
excluded. Public project/profile paths use route templates. Query strings,
fragments, referrers, titles, arbitrary properties and person updates are
removed before sending. SDK-generated random identifiers and bounded viewport
dimensions remain; analytics cannot accept an email address as a distinct ID.

Replay, autocapture, console recording, error autocapture, surveys, tours,
heatmaps, and automatic PostHog performance capture are disabled. Remote
configuration cannot re-enable those features. The existing Vercel performance
integration is separate. A new event or performance payload needs a documented
field contract and privacy tests before capture is enabled.

Use `bun test lib/analytics-privacy.test.ts` for the synthetic payload contract.
Before release, inspect actual browser requests from the accepted build with
synthetic emails, tokens, names and document content. Verify navigation from a
public page to a private page and back. Do not use real student records as test
markers.

This source policy does not delete historical provider data or change live
project settings. Historical access, retention and deletion decisions require
their own reviewed operational record. Deploying the source change and
verifying live sanitized traffic are separate release steps.

References: [PostHog browser configuration](https://posthog.com/docs/libraries/js/config)
and [redacting event data](https://posthog.com/tutorials/web-redact-properties).

## Server diagnostics

The logger exports only the static names in `lib/log-event-catalog.ts` and the
field contracts in `lib/log-privacy.ts`. Unknown messages become an unregistered
application event. Error text, stacks, names, addresses, titles, provider bodies,
URLs, Sheet ranges, and person identifiers are omitted. Add a reviewed event
name or bounded field contract when new operational diagnostics need it. Keep
variable content in the authorized application data model rather than logging it.

Runtime console calls use `lib/safe-console.ts` in both browser and server code.
Its static event catalog is `lib/log-console-events.json`. It discards positional
strings, nested objects, request data, error messages, and stacks. It reads only
own data properties, without invoking error or object getters. Recognized error
codes, counters, closed outcome vocabularies, and opaque request receipts can
remain. Resend logs keep a bounded digest for rejected-envelope correlation;
provider and tenant identifiers stay in the restricted delivery ledger.

Project signup diagnostics use a closed step catalog and a random request trace.
They do not serialize form submissions, signup identities, or provider errors.
ESLint rejects native console access in root runtime code, including aliases.
The sink and test fixtures are exempt. Private-plugin source has its own release
boundary and must be reviewed separately before claiming full-stack coverage.

Run `bun test lib/safe-console.test.ts` and
`bun test scripts/security/runtime-log-boundary.test.mjs` for the synthetic
payload and source-boundary regressions. Keep the existing webhook suites when
changing the closed delivery vocabulary. Missing fields need a reviewed contract,
not a raw-console exception.

The Node request-error hook records a fixed event category, HTTP method, router
kind, and route type. It never reads request headers or URLs. Flush attempts have
a 1.5-second wait limit so a stalled exporter cannot hold an application error
open. Export is best effort; deployed delivery and scheduler silence still need
separate monitoring checks.

Server logs and traces export only from hosted Production. Resource attributes
include the deployment environment and a validated full release SHA. Preview and
local runs need a separate, explicitly configured telemetry destination before
external collection is enabled there. The private plugin import migration must
land before adding the final `server-only` logging guard. This source change does
not remove historical provider data or establish alert ownership and source-map
coverage.
