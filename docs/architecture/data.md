# Data and authorization boundaries

## Public platform data

Ordinary application tables use Supabase RLS as the primary row boundary. Server Actions still validate intent and role because privileged server clients can bypass RLS.

## Plugin data

`plugin_data` is not a browser API. Only server-side code may access it, every query or transaction must include organization scope, and externally reachable actions must prove the relevant plugin capability. Cross-tenant foreign keys and pgTAP denial tests are required for new relationships.

Uninstall never accesses `plugin_data`; it removes only platform install/configuration state and therefore retains plugin-owned tenant data. Permanent deletion is a separate server-only path gated by a complete manifest target inventory and an idempotent organization-scoped hook. Its private receipt stores scope identifiers, a SHA-256 request fingerprint, bounded platform error codes, claim/attempt state, and independent audit status—never confirmation text, plugin rows, storage content, or raw provider errors.

Because plugin hooks may cross non-transactional provider boundaries, a process crash can leave a `processing` receipt whose outcome is unknown. That state is not automatically rerun. Explicitly reported idempotent failures may retry under the same globally bound request key with a fresh claim token; successful deletion is durable before audit is attempted.

The enforced browser boundary for `plugin_data` is schema `USAGE`, which `PUBLIC`, `anon`, and `authenticated` do not hold. Object grants and the schema's default privileges are also closed for browser roles, but PostgreSQL's built-in global default still puts `EXECUTE` for `PUBLIC` on any newly created function, and a per-schema `ALTER DEFAULT PRIVILEGES` cannot revoke a globally granted default. A new private-plugin function therefore carries a `PUBLIC` execute bit that is unreachable without schema usage. Never grant `plugin_data` schema usage to `PUBLIC`, `anon`, or `authenticated`, and keep proving unreachability by calling as browser roles rather than by reading the object ACL alone.

## Private helper schemas

`private` and `app_private` are omitted from PostgREST's exposed schemas; that routing boundary does not replace function ACLs. Some helpers are invoked from reviewed RLS policies and therefore intentionally retain narrow role execution. Repository policy requires every function in `private` or `app_private` to carry explicit per-object execution revokes and reviewed grants, including a deliberate decision for `PUBLIC`, `anon`, `authenticated`, and `service_role`. A new or replaced definer must also use a fixed safe `search_path`. The DV student and household helpers retain `authenticated` execution only because authenticated DV policies call them; `PUBLIC`, `anon`, and `service_role` do not.

## Moderation evidence

`content_reports` is server-written. Browser roles hold owner-scoped `SELECT` and no `INSERT`, `UPDATE`, or `DELETE`; every report is created by one reviewed `SECURITY DEFINER` transaction that only `service_role` may execute. Status, priority, timestamps, the pseudonymous reporter reference, and the quota decision are derived inside that transaction, so they cannot be supplied by a client.

A report may only name a target the reporter can already read through their own RLS-scoped session, and only for the target types the moderation queue can act on (`project`, `profile`, `organization`). The transaction independently confirms the target row exists in the literal relation its type names, so a forged identifier cannot become a queue item even if the caller's session check is wrong. Neither check is an enumeration oracle: the session check can confirm nothing the reporter could not read directly, and an unresolvable target is refused with the same generic `400` as any other invalid input.

Deduplication is bounded rather than permanent. Each submission carries a deterministic `request_fingerprint` derived from the reporter and the substance of the report, and the stored row carries a server-derived `replay_expires_at` 15 minutes out. A retry inside that window replays the original report without duplicating evidence or charging quota; the same report filed after it is a new report with an incremented `request_sequence`, which is what lets a dismissed issue be raised again. Client-supplied time never contributes to the fingerprint.

Two quotas are kept apart. A higher attempt ceiling is charged before the target lookup, so submissions that store nothing — an invisible target, a malformed location, a replay — are still bounded; the stored-report quota is charged only when a report is written. In both cases the user and address buckets are decided together: if either is exhausted, neither is charged. When no trusted address is available the address dimension is omitted rather than collapsed into a shared bucket.

`reporter_reference` is a random UUID drawn from the server-only `public.reporter_references` mapping, not a value derived from the account identifier, so holding a user UUID does not let anyone recompute it. Deleting or banning an account detaches the reporter link (`reporter_id` becomes null, in both the report and the mapping) and keeps the report and its reference. That is the retention boundary: moderation history and repeat-offender correlation survive, the personal link does not.

## Evidence and imports

Imports retain immutable source identity, range/tab provenance, mapping versions, and raw snapshots. Preview and reconcile are separate from commit. Spreadsheet values are treated as untrusted input and exports must prevent formula injection.

### CSF source constraints

- The identity-free historical S26 inventory is 167 records for 2027, 167 for 2028, and 88 for 2029: 422 total.
- The provided Class of 2030 source is header-only with 0 data rows. Operationally it is template-only: do not import it. Use only the ordinary member and application paths, or the audited semester-correction path (`Members` → `Add member`, then `Applications` → `Review queue`, or a reviewed correction)—never historical import.
- Historical sheets do not contain reliable account identifiers. They must not auto-link a profile to an account; linking requires separately corroborated evidence and reviewed conflict handling.
- Application responses create application records, never members, and do not independently establish a roster.
- The Spring 2026 application source cannot seed a Fall 2026 roster. Its responses may attach only after reviewed member/application reconciliation. Application, cohort, membership, and term state remain distinct.
- Persist each source snapshot immutably before preview. Commit must revalidate the current actor, organization, install/entitlement, source identity and version, mapping, and target term; preview-time authorization is not sufficient.

These constraints describe source shape without recording identities. Source rows and account-link evidence remain private, server-only data.

## Waiver publication

RLS on `public.projects` is column blind, so an organizer holds a direct
UPDATE on their own project row. Staging a waiver project in application code
is therefore not a boundary on its own. The trigger function
`private.protect_waiver_project_publication` refuses every browser-role write
that would produce a published waiver-required project, change such a
project's waiver switches, attach a
`waiver_definition_id`, or point `waiver_pdf_storage_path` outside the
project's own `project_waivers/{projectId}/` prefix.

The only ways into that state are the service-role RPCs
`public.publish_waiver_staged_project` and
`public.apply_project_waiver_settings`. Both are organizer-scoped, take the
project row `FOR UPDATE`, and share one proof helper,
`private.waiver_publication_blocker`, which requires a real Storage object
behind the source path, a usable signing mode, and — when e-signatures are on
— an active project-scoped definition pinned to that same object with a
signature placement. A missing `storage.objects` catalog raises rather than
counting as proof.

A row that was already published and already waiver-required stays editable
for everything else, so no project published before this boundary existed is
stranded by it. The migration reports only an aggregate count of such rows and
never identifies them; reviewing those pre-boundary projects is an operator
task, not a repository defect.

## Personal calendar receipts

Personal project and signup calendar sync stores its complete event plan in
`app_private.personal_calendar_sync_receipts` before any event write to Google.
The service-only claim derives ownership from the source row, serializes with
account deletion, and leases one worker. The plan pins the destination calendar,
a fresh generation, every event ID, and the payload snapshot. Confirmed provider
steps survive retries; the source's sync timestamp is set only when all planned
events have completed. Removal confirms every planned ID before clearing the
source marker. A later add uses a new generation so deleted Google IDs are never
reused.

Deleting a project or signup preserves its receipt for external cleanup. Account
deletion must refuse unresolved provider plans before deleting the Auth user.
Browser roles cannot read or mutate these receipts, or invoke either actor-taking
RPC. Legacy records can remove their one stored event ID; occurrences that old
code created without storing an ID still require provider reconciliation.

Personal calendar destinations use the existing
`plugin_data.csf_personal_calendar_destinations` ledger for both platform and CSF
events. Its service-only public wrappers take the account deletion lock before
reserving a provider attempt. Unknown creation outcomes block new calendars.
Legacy preference IDs may be adopted only after Google confirms the exact live,
non-primary calendar is owned by the connected account. Adoption locks the
current OAuth binding and preferences and never replaces an existing ledger
entry. Deleted-source event receipts appear in the account calendar cleanup
list, limited to 100 entries per read; removing entries reveals the next batch.

## Organization calendar receipts

Organization calendar provisioning reserves a service-only destination operation
before the Google create request. Verified adoption locks the active admin and
exact organization OAuth binding. The destination and compatibility sync config
commit together. Unknown creation outcomes block another calendar creation;
operators must reconcile the provider result before changing that state. Browser
configuration edits cannot replace the canonical destination.

Project and CSF projections share private event receipts. Each receipt stores its
calendar, provider event ID, source coordinates, immutable pending payload, and
latest desired payload. A leased worker loads complete keyset pages before
planning writes. The database checks tenant and publication state, rejects an
incomplete snapshot of tracked publishable sources, and limits each projection
plan to 10,000 events and 8 MiB. A read failure or limit stops the sync rather than
treating missing rows as deleted sources.

Provider retries reuse the saved event ID. Conflicting IDs require a matching
receipt marker; updates use Google's ETag with `If-Match` and renew the worker
lease before writing. A confirmed missing or deleted event gets a new saved ID.
Unchanged events avoid repeated writes and become due for provider reconciliation
after 24 hours. Each run processes at most 200 transitions or 25 seconds before
starting another event; a provider request has a 10-second timeout. Pending work
survives a timeout, and the next manual or scheduled run continues it.

Deleting a source or compatibility binding preserves its private receipt. Cleanup
uses the retained calendar and event IDs. Removing and then re-adding an occurrence
uses a fresh ID after deletion is confirmed. Organization deletion is restricted
while destination or event receipts remain; account deletion preflight must retain
restrictive destination-owner references until a reviewed ownership transfer or
provider cleanup. Organization calendars exclude officer-only CSF deadlines.
Deploying this code does not reconcile historical untracked events or remove
previously exported content from Google. Those are separate provider rollout
checks.

## Sensitive data

Do not commit real member/student workbooks, contact exports, OAuth tokens, browser state, traces, or provider payloads. Local fixtures use fictional identities and reserved domains. Curated evidence is manually reviewed and lives only under `docs/csf/evidence/`.

## Schema change rule

Historical migrations are immutable. Fixes use a new forward migration, security/RLS review, isolated replay, and pgTAP coverage.
