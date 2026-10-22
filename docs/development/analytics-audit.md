# Analytics source audit

This audit starts from Development `accba0cfc2cd2f880b5632f4535cea822947da94`
and retains private gitlink `38dc7c7aff6fd101c87f92eebfae822d1726f2b4`.
The work is local to `codex/posthog-privacy-20261011`. It does not resume the
cancelled merge or release. No PostHog settings, credentials, collection flags,
dashboard records, Production resources or real user content were changed.

## Source findings

| Area              | Development source                                                                                                                                                                                    | Remaining evidence or repair                                                                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GeoIP             | `lib/analytics-privacy.ts` adds `$geoip_disable: true` to rebuilt pageviews and sets `ip: false`.                                                                                                     | Verify the accepted served build. Main `18e5aa7b` and last verified Production source `fb326cb3` use the older unrestricted browser initialization. Source protection does not repair historical provider data. |
| Replay and inputs | Replay, console recording, autocapture, heatmaps and dead/rage clicks are disabled. Remote flags and external dependency loading are disabled. The event callback rejects snapshots.                  | No real recordings inspected. Input masks are not a substitute for this disabled-replay policy. Route-specific replay is not enabled.                                                                           |
| Private routes    | Only reviewed public pageviews pass. Private and unknown routes are dropped. Public project/profile IDs become route templates; query, fragment, title, referrer and person properties are discarded. | The live taxonomy and current deployment still need the separate remote audit.                                                                                                                                  |
| Exceptions        | Browser exception collection is disabled and `$exception` is rejected. The server hook uses scrubbed logs without request URL, headers, body, raw error text or stack.                                | Server log resource `service.version` accepts a full SHA. It is not a verified `$release_id` on PostHog exception events. Browser exceptions should remain disabled until a reviewed error contract exists.     |
| AI content        | Development already sets `recordInputs: false` and `recordOutputs: false`. The old helper still spread arbitrary metadata and exported user and organization identities.                              | This patch replaces that spread with eleven closed operation contracts and disables unknown/local/Preview telemetry. Exporter delivery and SDK compatibility remain unverified.                                 |
| Workflow metrics  | No custom volunteer outcome capture found in runtime source. The browser callback intentionally accepts pageviews only.                                                                               | Propose aggregate server outcomes below. This patch adds no emitter and enables no new collection.                                                                                                              |

The parent supplied count-only PostHog observations for project 130209. In seven
days, 2,059 of 2,059 pageviews and 11 of 11 exceptions have latitude properties.
Recorder-attached is true on 1,063 pageviews and nine exceptions. None of those
exceptions has `$release_id`. The 30-day counts are 14,606 pageviews, 46,774
autocapture events, 313 exceptions and 28 AI generations, last observed September 28. These observations were not independently queried by this local audit. They
do not prove which source or producer emitted each event, that a replay contains
sensitive text, or that absent custom events mean users did not complete work.

## Proposed aggregate metrics

Keep this proposal disabled until its event contract, durable producer and
synthetic transport tests are reviewed. Emit no names, actor/organization/project
IDs, URLs, signup answers, waiver contents, signatures, coordinates, provider
response text, prompts or outputs. Use only a fixed workflow name, closed outcome,
bounded count and latency, deployment environment, schema version and validated
release SHA. A fixed service identity can support totals; it cannot measure unique
volunteers or a person-level conversion funnel.

| Proposed workflow        | Authoritative success boundary                                                                                    | Useful aggregate measurement                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Project creation         | Authorized durable project creation commits. Draft and publication are separate outcomes.                         | Created and published counts; rejected/failed attempts; time to publish only from a reviewed aggregate projection. |
| Signup                   | Durable signup transition commits. A button click or form submission is not success.                              | Accepted, rejected and capacity-denied totals; avoid person-level conversion claims.                               |
| Waiver completion        | Required waiver evidence and acceptance commit under the existing authorization boundary.                         | Completed count and bounded failure categories; no document or signing metadata.                                   |
| Attendance               | Authorized check-in/out transition commits. Retries and manual correction do not create duplicate success counts. | Check-in/out totals and rejected transitions; no visitor details or timestamps exported.                           |
| Certificates             | A new immutable certificate issuance commits. Resend, correction and email-provider acceptance are separate.      | Issued, corrected and delivery-outcome totals; unknown delivery remains unknown.                                   |
| Calendar and Sheets jobs | Durable worker outcome records the source and provider result. HTTP 200 alone is insufficient.                    | Successful/failed/blocked/unknown runs, rows processed, bounded latency, stale completion and queue-age metrics.   |

Use a local durable receipt or existing immutable outcome to deduplicate producer
retries, while keeping its identifier out of PostHog. Daily count-only summaries
may be simpler than individual events. Preserve separate accepted and unknown
provider outcomes. No scheduler, receipt schema or summary job was created here.

The remote dashboard worker can use this contract for three proposed views:
platform traffic from sanitized public pageviews, completed volunteer workflow
totals once their producers exist, and worker reliability from durable outcomes.
Existing retention or funnel charts must state their identity and denominator
limits. A successful source test is not dashboard ingestion or deployed worker
evidence.

## References and verification

- [PostHog JavaScript configuration](https://posthog.com/docs/libraries/js/config)
- [PostHog replay privacy](https://posthog.com/docs/session-replay/privacy)
- [PostHog AI custom properties](https://posthog.com/docs/ai-observability/custom-properties)
- [Current Vercel AI observability integration](https://posthog.com/docs/ai-observability/installation/vercel-ai)

Run `bun test lib/ai/posthog-telemetry.test.ts lib/analytics-privacy.test.ts`.
Run `bun test lib/ai/posthog-accounting-boundary.test.ts` separately, then the
existing AI tracking test in its own process. Run the logger privacy test with
`bun test --preload ./scripts/local-dev/server-only-test-preload.ts lib/logger.privacy.test.ts`.
Run affected
ESLint, formatting, TypeScript and strict gitlink checks. No build, database reset,
browser recording or provider write is needed for this local source patch.
