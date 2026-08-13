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

A report may only name a target the reporter can already read through their own RLS-scoped session, and only for the target types the moderation queue can act on (`project`, `profile`, `organization`). The existence check adds no enumeration oracle because it can confirm nothing the reporter could not read directly, and an unresolvable target is refused with the same generic `400` as any other invalid input.

Each submission carries a deterministic request key derived from the reporter and the substance of the report, so a retry replays the original report instead of duplicating evidence or charging quota twice. The user and IP quota buckets are decided together in that same transaction: if either bucket is exhausted, neither is charged.

Deleting or banning an account detaches the reporter link (`reporter_id` becomes null) and keeps the report and its irreversible `reporter_reference` digest. That is the retention boundary: moderation history and repeat-offender correlation survive, the personal link does not.

## Evidence and imports

Imports retain immutable source identity, range/tab provenance, mapping versions, and raw snapshots. Preview and reconcile are separate from commit. Spreadsheet values are treated as untrusted input and exports must prevent formula injection.

## Sensitive data

Do not commit real member/student workbooks, contact exports, OAuth tokens, browser state, traces, or provider payloads. Local fixtures use fictional identities and reserved domains. Curated evidence is manually reviewed and lives only under `docs/csf/evidence/`.

## Schema change rule

Historical migrations are immutable. Fixes use a new forward migration, security/RLS review, isolated replay, and pgTAP coverage.
