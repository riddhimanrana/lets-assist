# Public SignUpGenius import candidate

This candidate is **not ready for release**. It implements the fetch boundary,
typed preview, public tool, project-editor handoff and a narrow standards-backed
JSON-LD Event adapter. There is no evidence that SignUpGenius emits the supported
structured data, and no SignUpGenius-specific DOM adapter has been implemented.
Ordinary unverified signup markup returns `unsupported`. No real signup has been
successfully extracted in this environment. Do not merge or advertise working
SignUpGenius import support on the strength of synthetic standards fixtures.

## User flow and data boundary

The main-site footer links to `/tools/signupgenius`. A public POST to
`/api/import/signupgenius` accepts one URL, consumes the existing durable quota,
fetches only an allowed public event page and validates the extracted projection.
It never writes a project or a signup. Failure to meter requests fails closed.

The editable projection contains only a canonical source URL, event title,
description, location, optional timezone and at most 100 named dated slots with
explicit start/end times and total capacities. It has no participant collection,
occupancy, contact, comment or arbitrary draft field. Unknown/missing dates,
times or capacities cannot be presented as an extracted preview. A missing
timezone requires an explicit choice before editor handoff. Original structured
timestamps and offsets remain visible in each slot; an offset is not treated as
an IANA regional timezone. A timezone choice conflicting with unchanged source
timing requires correction. Dates are never shifted into the future; historical
dates remain visible until the organizer explicitly changes them.

Bounded source preservation and destination readiness are separate. The preview
can retain a title of 200 characters, description of 10,000, location of 500,
slot name of 200 and capacity of 10,000. Before handoff, the **existing destination
schemas** enforce their actual title/description/location/slot-name/capacity
limits (125/2000/250/75/1000), required fields and future schedule rule. Each
problem is shown at its field. Values are never silently shortened or capped.

An organizer checks the details and authorizes the import, then continues to the
existing authenticated project editor. Tab-scoped storage holds only that
validated projection for up to 24 hours, under a random per-import reference.
The existing create route enforces authentication; its existing editor performs
normal draft autosave, validation and final review. A supplied existing draft
takes precedence over import storage. The importer neither changes a different
autosave nor calls create/publish actions. Imported defaults use unlisted
visibility, require login and keep public attendee display off.
The login fallback preserves bounded organization, draft, creation and import
context. Organization authority still comes from server-side membership checks;
source data cannot select an organization. A server-validated organization is
kept when initializing the imported editor. Navigation uses a React transition
so a completed or restored importer is not permanently stuck in a loading state.

## Standards-backed adapter

This is a conservative subset of the official [Schema.org Event](https://schema.org/Event)
and [maximumAttendeeCapacity](https://schema.org/maximumAttendeeCapacity) contracts.
It does not assert that SignUpGenius uses either field.

- Read only inline `application/ld+json` using the existing HTML parser. Never
  execute scripts, fetch a remote script/context or resolve an `@id` reference.
  Inert templates and unknown contexts are unsupported.
- Require a canonical Schema.org context and one explicit Event, directly or
  in an `@graph`. Multiple unrelated events, recurrence schedules, cancelled or
  rescheduled status, unresolved child references and nested sub-events fail.
- A single event or its inline `subEvent` records must supply explicit full
  dates, minute-resolution start/end times and positive integer
  `maximumAttendeeCapacity`. Remaining places, offers and participant counts are
  never used as total capacity. Parent envelope and child timing must agree;
  unsupported overnight slots and contradictory offsets fail.
- Project only event metadata, selected Place/PostalAddress text and explicit
  slots. Do not traverse attendee, organizer, Person, contact or comment
  payloads. Strip markup and contact-like email/phone text in selected fields.
  This projection proof is synthetic and does not establish isolation of a
  live provider's DOM or page payload.
- Bound each script to 64 KiB, all structured data to 128 KiB, eight scripts,
  nesting depth 16 and 2,000 JSON nodes, within the existing 1 MiB page limit.
  No dependency version or lockfile change is required.

## Fetch constraints

- Only `signupgenius.com`, `www.signupgenius.com` and `m.signupgenius.com`, public
  `/go/<id>` paths and the documented-in-source mobile hash shape are accepted.
  HTTP inputs become HTTPS; queries are discarded. Userinfo, explicit ports,
  alternate hosts, arbitrary paths and encoded path components are refused.
- Actual requests use HTTPS to the canonical `www` host, fixed request headers,
  no cookies or caller headers, no connection pooling and a validated pinned DNS
  address. Every DNS answer must be globally routed; private, reserved and
  transition networks fail closed. Each redirect receives the same checks.
- One 10-second deadline covers resolution, at most two redirects and reading
  the body. HTML bodies are capped at 1 MiB including streamed chunks. Compressed
  or non-HTML responses are refused. No source HTML is persisted or logged.
- Browser challenges are reported without alternate endpoints, challenge
  solving, cookies, proxies or access-control workarounds. Public POST responses
  are private/no-store and use fixed error messages.

## Evidence and remaining gates

| Boundary                                                   | Candidate status                                                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| URL, SSRF, size/time limits, typed projection and storage  | Synthetic unit coverage                                                                                    |
| Standards-backed structured Event projection and readiness | Synthetic JSON-LD, privacy, offset, bounds and destination-limit coverage                                  |
| API metering, origin checks and error responses            | Isolated mocked service coverage                                                                           |
| Public UI at 1280, 390 and 320 pixels                      | Synthetic browser component coverage; real UI/CSS, mocked API/navigation                                   |
| Actual SignUpGenius extraction and participant exclusion   | Blocked pending inspected source representation and real fetch proof                                       |
| Authenticated persisted draft/create workflow              | Route, organization-context and saved-draft precedence regressions; full authenticated acceptance required |
| Full static/build gates                                    | Environment missing existing SheetJS dependency; no waiver implied                                         |
| Hosted Development and Production                          | Not deployed or verified                                                                                   |

Focused commands:

```sh
bun test lib/signupgenius/import.test.ts services/signupgenius-fetch.test.ts services/signupgenius-parser.test.ts
bun test services/signupgenius-jsonld.test.ts lib/signupgenius/readiness.test.ts lib/projects/creation-session.test.ts
bun test app/api/import/signupgenius/route.test.ts
bun test app/api/import/signupgenius/structured-data.integration.test.ts
bun test services/signupgenius-transport.test.ts
bun test app/projects/create/page.draft-intent.test.tsx
bun test app/projects/create/ProjectCreateEntry.test.tsx
bun tests/e2e/signupgenius/import.browser.ts
```

The browser harness owns a loopback server and uses only fictional data. Its
navigation stub proves a validated tab handoff, not authentication or database
persistence. Screenshots remain ignored under `.artifacts/signupgenius-import`.
Run the native transport test separately: it mocks Node HTTPS and DNS modules,
as detected by the repository's isolated test orchestrator. It verifies the
actual transport's URL, fixed request headers, DNS pin, address family and
private-address refusal without opening a network connection.

Supplemental coordinator evidence for `5cdc88af`: the 65 synthetic importer
tests and full typecheck passed on an isolated Mac checkout using existing
dependencies. That machine used Bun 1.3.14, so this is not the pinned Bun 1.4.2
release gate. No Mac build or deployment was reported. This implementation
worker continues to use only the selected cloud container.

The source researcher later lost the previously accessible browser tab; a fresh
navigation failed with `net::ERR_HTTP_RESPONSE_CODE_FAILURE`. Only earlier AX
observations remain: event metadata inside `#signupcontainer`, a table headed
Available Slot, slot labels/occupancy alongside distinct participant subtrees.
No exact DOM fixture or server HTML was preserved. These observations do not
establish selector semantics, event-date provenance or participant isolation,
so they do not authorize adding a DOM adapter with guessed selectors.

Before adding a provider-specific adapter, inspect the actual **server-fetch** HTML,
not just the rendered browser DOM. Preserve structural attributes but replace
text and remove participant subtrees in any committed fixture. Extract event
and slot fields by explicit context, never whole-table text. The source event
description can mention training dates distinct from the event; absent explicit
event/slot dates must fail rather than using prose guesses or AI defaults. Do
not use participant-report endpoints. The official key-based API requires owner
authorization and is not an anonymous arbitrary-signup-link API.

Release follows the existing [deployment workflow](deployment.md): one reviewed
integration into `development`, exact hosted Development acceptance, then the
separately authorized `development` to `main` release and protected Production
workflow. A feature push creates no Preview deployment. This candidate must
remain draft until source extraction and required gates are verified.
