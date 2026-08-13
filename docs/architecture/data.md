# Data and authorization boundaries

## Public platform data

Ordinary application tables use Supabase RLS as the primary row boundary. Server Actions still validate intent and role because privileged server clients can bypass RLS.

## Plugin data

`plugin_data` is not a browser API. Only server-side code may access it, every query or transaction must include organization scope, and externally reachable actions must prove the relevant plugin capability. Cross-tenant foreign keys and pgTAP denial tests are required for new relationships.

Uninstall never accesses `plugin_data`; it removes only platform install/configuration state and therefore retains plugin-owned tenant data. Permanent deletion is a separate server-only path gated by a complete manifest target inventory and an idempotent organization-scoped hook. Its private receipt stores scope identifiers, a SHA-256 request fingerprint, bounded platform error codes, claim/attempt state, and independent audit status—never confirmation text, plugin rows, storage content, or raw provider errors.

Because plugin hooks may cross non-transactional provider boundaries, a process crash can leave a `processing` receipt whose outcome is unknown. That state is not automatically rerun. Explicitly reported idempotent failures may retry under the same globally bound request key with a fresh claim token; successful deletion is durable before audit is attempted.

The enforced browser boundary for `plugin_data` is schema `USAGE`, which `anon` and `authenticated` do not hold. Object grants and the schema's default privileges are also closed for both roles, but PostgreSQL's built-in global default still puts `EXECUTE` for `PUBLIC` on any newly created function, and a per-schema `ALTER DEFAULT PRIVILEGES` cannot revoke a globally granted default. A new private-plugin function therefore carries a `PUBLIC` execute bit that is unreachable without schema usage. Never grant `plugin_data` usage to a browser role, and keep proving unreachability by calling as those roles rather than by reading the ACL.

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
- The Class of 2030 source is header-only (0 rows): do not import. Class of 2030 must enter through the new application-cycle/member-review workflow, not historical import.
- Historical sheets do not contain reliable account identifiers. They must not auto-link a profile to an account; linking requires separately corroborated evidence and reviewed conflict handling.
- Application responses create application records, never members, and do not independently establish a roster.
- The Spring 2026 application source cannot seed a Fall 2026 roster. Its responses may attach only after reviewed member/application reconciliation. Application, cohort, membership, and term state remain distinct.
- Persist each source snapshot immutably before preview. Commit must revalidate the current actor, organization, install/entitlement, source identity and version, mapping, and target term; preview-time authorization is not sufficient.

These constraints describe source shape without recording identities. Source rows and account-link evidence remain private, server-only data.

## Sensitive data

Do not commit real member/student workbooks, contact exports, OAuth tokens, browser state, traces, or provider payloads. Local fixtures use fictional identities and reserved domains. Curated evidence is manually reviewed and lives only under `docs/csf/evidence/`.

## Schema change rule

Historical migrations are immutable. Fixes use a new forward migration, security/RLS review, isolated replay, and pgTAP coverage.
