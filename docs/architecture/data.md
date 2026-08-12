# Data and authorization boundaries

## Public platform data

Ordinary application tables use Supabase RLS as the primary row boundary. Server Actions still validate intent and role because privileged server clients can bypass RLS.

## Plugin data

`plugin_data` is not a browser API. Only server-side code may access it, every query or transaction must include organization scope, and externally reachable actions must prove the relevant plugin capability. Cross-tenant foreign keys and pgTAP denial tests are required for new relationships.

Uninstall never accesses `plugin_data`; it removes only platform install/configuration state and therefore retains plugin-owned tenant data. Permanent deletion is a separate server-only path gated by a complete manifest target inventory and an idempotent organization-scoped hook. Its private receipt stores scope identifiers, a SHA-256 request fingerprint, bounded platform error codes, claim/attempt state, and independent audit status—never confirmation text, plugin rows, storage content, or raw provider errors.

Because plugin hooks may cross non-transactional provider boundaries, a process crash can leave a `processing` receipt whose outcome is unknown. That state is not automatically rerun. Explicitly reported idempotent failures may retry under the same globally bound request key with a fresh claim token; successful deletion is durable before audit is attempted.

## Evidence and imports

Imports retain immutable source identity, range/tab provenance, mapping versions, and raw snapshots. Preview and reconcile are separate from commit. Spreadsheet values are treated as untrusted input and exports must prevent formula injection.

## Sensitive data

Do not commit real member/student workbooks, contact exports, OAuth tokens, browser state, traces, or provider payloads. Local fixtures use fictional identities and reserved domains. Curated evidence is manually reviewed and lives only under `docs/csf/evidence/`.

## Schema change rule

Historical migrations are immutable. Fixes use a new forward migration, security/RLS review, isolated replay, and pgTAP coverage.
