# Data and authorization boundaries

## Public platform data

Ordinary application tables use Supabase RLS as the primary row boundary. Server Actions still validate intent and role because privileged server clients can bypass RLS.

## Plugin data

`plugin_data` is not a browser API. Only server-side code may access it, every query or transaction must include organization scope, and externally reachable actions must prove the relevant plugin capability. Cross-tenant foreign keys and pgTAP denial tests are required for new relationships.

## Evidence and imports

Imports retain immutable source identity, range/tab provenance, mapping versions, and raw snapshots. Preview and reconcile are separate from commit. Spreadsheet values are treated as untrusted input and exports must prevent formula injection.

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
stranded by it. The migration reports only an aggregate count of such rows;
reviewing them is tracked as CLEAN-022 in
[the cleanup register](../development/cleanup-register.md).

## Sensitive data

Do not commit real member/student workbooks, contact exports, OAuth tokens, browser state, traces, or provider payloads. Local fixtures use fictional identities and reserved domains. Curated evidence is manually reviewed and lives only under `docs/csf/evidence/`.

## Schema change rule

Historical migrations are immutable. Fixes use a new forward migration, security/RLS review, isolated replay, and pgTAP coverage.
