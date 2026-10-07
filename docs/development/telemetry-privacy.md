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
