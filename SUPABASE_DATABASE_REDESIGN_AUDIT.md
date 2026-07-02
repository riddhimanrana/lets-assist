# Supabase Database Redesign Audit

Date: 2026-07-01
Project ref: `fotdmeakexgrkronxlof`

## Status

This document is the tracked handoff for the local/remote Supabase redesign work. It records the safe baseline checks, current advisor themes, and the target phased design so hardening work can proceed through migrations instead of one-off remote edits.

The repo is linked to remote project `fotdmeakexgrkronxlof`. Remote migration authentication currently requires `SUPABASE_DB_PASSWORD`; without it, `supabase migration list --linked` cannot complete. A linked `supabase db diff` did run far enough to show destructive drift, including drops for newer waiver/plugin/DV schema objects. That drift should not be pulled blindly.

## MCP Targets

Root `.mcp.json` and `.vscode/mcp.json` define:

- `supabase-local`: `http://127.0.0.1:54321/mcp`
- `supabase-remote-readonly`: `https://mcp.supabase.com/mcp?project_ref=fotdmeakexgrkronxlof&read_only=true`
- `supabase-remote-writable`: `https://mcp.supabase.com/mcp?project_ref=fotdmeakexgrkronxlof`

Policy: use `supabase-remote-readonly` for inventory and advisors by default. Use writable remote MCP only after a migration replays locally, advisor output is reviewed, and the exact remote action is deliberate.

## Baseline Sync Findings

Local and remote migration histories were previously observed as matching through `20260621210000`, but current linked migration checks need the database password to verify again.

`supabase db diff --linked` showed high-risk drift. The diff included destructive statements against:

- `public.waiver_definitions` JSONB fields and signer structures
- `plugin_data.dv_sd_*` tables, constraints, and indexes
- denormalized `organization_id` columns on DV tournament/link tables
- policies and grants that support current plugin workflows

Conclusion: do not run `supabase db pull` until the generated diff is saved and reviewed table-by-table. The safer path is to treat migrations in this repo as the intended source of truth, replay locally, then compare remote drift again with a focused allow/deny list.

## Advisor Themes

Remote linked advisor checks before this pass still report 194 issues:

- GraphQL/Data API exposure for many `public` and `plugin_data` tables to `anon` and `authenticated`
- public storage object listing for `avatars` and `organization-logos`
- public execution grants on `SECURITY DEFINER` functions
- mutable `search_path` on security definer functions
- direct `auth.uid()` calls in two `public.projects` RLS policies
- duplicate plugin org indexes after later DV index migrations
- multiple permissive policies on selected plugin and invitation tables

The first migration fixes the low-risk confirmed local items: fixed search paths, internal function execute grants, public bucket listing policies, direct `auth.uid()`/`current_setting()` RLS initplans, defensive duplicate index cleanup, and overlapping permissive policies that were safe to split by command.

After replaying all migrations locally, `supabase db advisors --local --output-format json` reports zero issues. Linked remote advisors still report the older 194 issues because this migration has not been applied remotely.

Broad table grant and GraphQL exposure changes are intentionally deferred because browser clients still access some base tables directly.

## Target Tenancy Model

### Identity and User Data

User-owned tables must isolate by `user_id` and use `(SELECT auth.uid())` in RLS. User-editable metadata must not participate in authorization decisions. Email synchronization helpers should remain trigger-only or private RPCs with fixed `search_path`.

### Organization Core Data

Org-owned tables must include `organization_id`, a foreign key to `public.organizations(id)`, and an index on tenant lookup paths. RLS should rely on membership/admin helpers in a private schema or on denormalized tenant keys when that removes repeated joins.

### Projects, Signups, Certificates, and Waivers

Public project discovery/detail, anonymous signup, attendance, certificate verification, and waiver preview/download flows are preserved. Public discovery should eventually move through narrow views or public read models instead of broad base-table grants.

### Plugin Platform Data

Long-term target: browser clients should not use `supabase.schema("plugin_data")` for broad reads/writes. Plugin data should move behind server actions, narrow RPCs, or constrained public views before `plugin_data` is removed from Data API exposure.

### DV Speech and Debate Plugin Data

DV tables should keep explicit `organization_id` tenant keys, RLS based on org membership/staff/admin role, and composite indexes matching actual list/detail queries. Seeded local DV workflows and `bun run dv:test:db` are the regression gate.

### Admin, System, and Cron Data

Cron and trigger functions should be private where possible, fixed-search-path, and not executable by `anon` or broad `authenticated` roles. Any app-required RPC should have a documented direct call site and explicit argument-level authorization.

### Storage Objects

Buckets should not expose broad listing policies. Public delivery is allowed where product flows require public avatars/logos, but object paths should remain tenant/user scoped:

- avatars: user-scoped path prefix
- organization logos: organization-scoped path prefix
- plugin form uploads: organization/form/user scoped path segments
- data exports: private bucket only, server-generated access

## Migration Phases

### Phase 1: Current Hardening

- Fix advisor-backed `search_path`, storage listing, internal function execute grants, RLS initplan, and duplicate-index issues.
- Do not remove table grants that current browser code may still need.
- Re-run local reset and advisors.

### Phase 2: API Exposure Reduction

- Inventory direct browser calls to `plugin_data` and broad `public` tables.
- Replace direct plugin browser access with server actions/RPCs/views.
- Revoke `anon` exposure from plugin tables first.
- Reduce `authenticated` exposure only after each app path has a replacement.
- Store each plugin's runtime contract in `public.plugin_runtime_contracts`: routes, surfaces, behavior hooks, backend capabilities, data access, storage access, required scopes, and lifecycle hooks.
- Use `public.organization_plugin_routes` for organization-specific plugin subroutes instead of adding bespoke host routes for every customer/plugin.
- Treat manifest `dataAccess` declarations as the migration checklist for replacing raw `plugin_data` browser access.

### Phase 3: Tenant Read Models

- Add public views/read models for project discovery, certificate verification, public profiles, and plugin public pages.
- Keep sensitive base tables in `public`, `plugin_data`, or `private` with narrow grants.
- Use `WITH (security_invoker = true)` where views must honor caller RLS.

Implemented locally in `20260701042331_tenant_read_models_phase3.sql`:

- `public.public_profile_read_model`: public-safe profile fields only; removes email, phone, goals, metadata, and update timestamps from public profile lookup paths.
- `public.project_discovery_read_model`: public project discovery shape with narrow creator and organization fields; excludes review notes and staff-only workflow data.
- `public.certificate_verification_read_model`: public certificate verification shape; excludes volunteer email and nested profile objects.
- `public.user_certificate_read_model`: authenticated user's certificate list shape with project timezone joined in one place.
- `idx_projects_public_discovery_created_at`: partial index for the default public project feed filter and sort.

Code moved to these models:

- Public profile helpers in `lib/profile/public.ts`.
- Public project discovery in `app/home/actions.ts` when no organization scope is requested.
- Certificate verification page and metadata in `app/certificates/[id]/page.tsx`.
- Authenticated certificate list in `app/certificates/page.tsx`.

Organization-scoped project pages, admin/reporting paths, mutations, cron jobs, and plugin internals intentionally remain on base tables in this phase because they need broader internal fields or write paths. Those are later Phase 4/5 candidates after each call site has an explicit authorization and replacement model.

Plugin public pages are represented by Phase 2 runtime contracts and `organization_plugin_routes`. A plugin can now declare `public-read-model`, `server-only`, `rls-client`, `rpc`, or `background-job` data access in its manifest. The next plugin migration should create plugin-specific read models only when a concrete route needs public/cross-domain data.

### Phase 4: RLS Consolidation

- Consolidate multiple permissive policies into command/role-specific policies.
- Standardize `TO anon` / `TO authenticated`.
- Add `WITH CHECK` everywhere inserts/updates accept client input.
- Move reusable authorization logic to private fixed-search-path helpers.

Implemented locally in `20260701044135_enterprise_plugin_isolation_controls.sql`:

- Removed direct `anon` privileges from all `plugin_data` tables, sequences, and schema usage.
- Added `public.organization_data_isolation_profiles` so regular organizations can remain on shared data while enterprise organizations can be marked for dedicated schema/project/external isolation.
- Added `public.organization_plugin_data_boundaries` so every installed plugin has an explicit organization/plugin data boundary, direct-client-access posture, and isolation mode.
- Added `private.sync_organization_plugin_data_boundary()` and trigger on `public.organization_plugin_installs` so new plugin installs automatically receive boundary records.
- Added `private.plugin_data_security_audit` to inspect plugin RLS, tenant columns, and direct API grants without exposing the audit view through the Data API.
- Added `bun run db:audit:plugin-isolation` to fail local validation if `plugin_data` regains anonymous direct table grants, loses RLS, or plugin installs lack boundaries.
- Added `bun run plugin:test:isolation` to run a browser/API smoke test: local login, disabled DV route 404, `/api/status`/project API calls during app load, and blocked anonymous REST access to `plugin_data`.
- The admin plugin control plane now includes a Data Boundaries tab backed by `public.organization_plugin_data_boundaries`.

Implemented locally in `20260701045444_plugin_data_explicit_policy_roles.sql`:

- Retargeted remaining `plugin_data` policies from implicit `PUBLIC` to explicit `authenticated` roles while preserving their existing `USING` and `WITH CHECK` predicates.
- Extended `bun run db:audit:plugin-isolation` so local validation fails if any `plugin_data` policy is recreated with `PUBLIC` policy roles.
- Verified the local policy scan returns no rows for `plugin_data` policies where `PUBLIC` is a policy role.

Implemented locally in `20260701050435_explicit_write_policy_checks.sql` and `20260701050524_plugin_data_tenant_lookup_indexes.sql`:

- Added explicit `WITH CHECK` predicates to write-capable RLS policies that previously relied on PostgreSQL fallback behavior.
- Added leading `organization_id` indexes to plugin tenant tables that already had tenant FKs but lacked tenant-leading lookup indexes.
- Added `bun run db:audit:architecture` as a broader local architecture gate for public/plugin RLS, plugin policy roles, write-policy checks, unsafe metadata authorization, unwrapped `auth.uid()`, tenant FKs/indexes, and security-invoker read models.
- The architecture audit now fails unexpected client `EXECUTE` grants on public `SECURITY DEFINER` functions and prints the remaining allowlisted grants for review.

Implemented locally in `20260701051022_harden_security_definer_execute_grants.sql`:

- Revoked broad `PUBLIC`, `anon`, and `authenticated` execution from trigger-only and server-only public `SECURITY DEFINER` functions.
- Re-granted authenticated-only execution to RLS helper functions still used by authenticated table policies: project insert/update helpers and trusted/project-organizer helpers.
- Kept the two current browser RPCs allowlisted for `anon` and `authenticated`: `public.check_email_exists(text)` for anonymous signup account checks and `public.get_public_attendees(uuid)` for project attendee display.
- Moved plugin audit/metrics RPC calls to the service-role admin client and granted those RPCs to `service_role` only.

Implemented locally in `20260701052148_ensure_storage_bucket_baseline.sql`:

- Made app storage buckets part of the migration baseline instead of relying only on local CLI side effects.
- Expected public delivery buckets: `avatars`, `organization-logos`, `project-images`, `project-documents`, `waiver-uploads`, and `waivers`.
- Expected private buckets: `data-exports` and `plugin_form_uploads`.
- Extended `bun run db:audit:architecture` to fail if expected buckets are missing, if bucket public/private posture drifts, or if `storage.objects` regains public/anon `SELECT` policies that expose object listings.

Implemented locally in `20260701052824_organization_isolation_profile_defaults.sql`:

- Added `private.ensure_organization_data_isolation_profile()` with fixed `search_path`.
- Added an `AFTER INSERT` trigger on `public.organizations` so every organization receives a default `shared` / `shared_plugin_data` isolation profile.
- Backfilled isolation profiles for existing organizations.
- Extended `bun run db:audit:plugin-isolation` so local validation fails if any organization lacks an isolation profile or any plugin boundary allows raw `rls_allowed` direct client access.

Implemented locally in `20260701054111_revoke_plugin_data_anon_default_privileges.sql`:

- Revoked anonymous schema usage and all current table/sequence/function privileges in `plugin_data`.
- Revoked `anon` default table, sequence, and function privileges from both `postgres` and `service_role` grantors so future plugin tables do not silently regain anonymous Data API access.
- Extended `bun run db:audit:plugin-isolation` to fail if current grants or default ACLs reintroduce `anon` access to `plugin_data`.

Implemented locally in `20260701055524_remove_plugin_data_data_api_exposure.sql`:

- Removed `plugin_data` from `supabase/config.toml` `api.schemas` so normal local Data API exposure is limited to `public` and `graphql_public`.
- Revoked `authenticated` schema usage and direct table/sequence/function privileges from `plugin_data`.
- Left `plugin_data` tables and RLS in place as internal storage for future server-only plugin backends.
- Changed `lib/plugins/supabase.ts` into a fail-closed legacy helper that requires `LETS_ASSIST_ENABLE_LEGACY_PLUGIN_DATA_API=true`, so new plugin code cannot accidentally construct direct `plugin_data` Supabase builders.

Implemented locally in `20260701055714_temporarily_disable_dv_plugin_catalog.sql`:

- Marked `dv-speech-debate` inactive in the plugin catalog.
- Disabled current DV organization installs.
- Marked existing DV plugin data boundaries as `disabled` and `blocked`.
- Kept the private DV code in the submodule for redesign, but removed it from the default local/bootstrap/test path.

Implemented locally in `20260701180752_organization_public_read_models_and_policy_hardening.sql`:

- Added `public.organization_public_read_model` as the public-safe organization list/detail surface. It excludes join codes, staff invite tokens, auto-join domains, allowed email domains, and creator internals.
- Added `public.organization_public_member_read_model` for public member directories gated by `organizations.show_members_publicly`, member visibility, and active status.
- Added `public.organization_invitation_acceptance_read_model` for a narrow invitation acceptance shape while preserving the existing token-header RLS requirement.
- Moved public organization listing/detail code to the new organization read models.
- Replaced the broad `organization_members` `PUBLIC` select policy with explicit anonymous public-directory access and authenticated self/org-member access.
- Retargeted `organization_sheet_syncs` policies from `PUBLIC` to explicit `authenticated`.
- Reduced anonymous organization-domain grants by revoking write/reference/trigger/truncate privileges from core organization tables and all anonymous access to integration/plugin-control tables that should not be public API surfaces.
- Extended `bun run db:audit:architecture` to fail if organization-domain policies target `PUBLIC`, if anonymous organization write/reference/trigger grants return, or if required organization read models are missing/non-`security_invoker`.
- Removed the active `LETS_ASSIST_ENABLE_DV_PLUGIN` test/config path so plugin availability is driven by catalog/install/entitlement/boundary state instead of per-plugin runtime flags.

Implemented locally in `20260701202252_add_remaining_fk_indexes_and_revoke_plugin_boundary_api_grants.sql`:

- Added leading FK indexes for the remaining DV Speech & Debate `plugin_data.dv_sd_*` relationship columns reported by the architecture audit.
- Added leading FK indexes for `organization_data_isolation_profiles.updated_by`, `organization_plugin_data_boundaries.updated_by`, and `organization_plugin_routes.created_by`.
- Revoked all direct `anon`/`authenticated` grants from `organization_data_isolation_profiles` and `organization_plugin_data_boundaries`; these are internal plugin isolation control-plane tables.
- Revoked all direct `anon`/`authenticated` grants from `organization_calendar_syncs` and `organization_sheet_syncs`; server actions and OAuth callbacks already verify org access and use the service client for integration config CRUD.
- Kept direct grants on `organizations`, `organization_invitations`, `organization_plugin_installs`, `organization_plugin_entitlements`, and `organization_plugin_feature_flags` for now because active call sites still depend on them. These should be removed only after org core/invitation/plugin resolver paths move behind narrow read models, server actions, or RPCs.

Implemented locally in `20260701202940_storage_auth_baseline_and_waiver_signature_bucket.sql`:

- Added `storage.buckets` baseline metadata for `waiver-signatures`, which app code already uses for server-managed signature images.
- Kept `waiver-signatures` private, capped at 2 MiB, and limited to PNG/JPEG signature images.
- Updated local Supabase bucket config so `plugin_form_uploads` and `waiver-signatures` are reproducible during `bun run supabase`.
- Extended `bun run db:audit:architecture` to verify storage bucket public/private posture, file-size limits, and allowed MIME types.
- Extended `bun run db:audit:architecture` to fail if server-only buckets (`data-exports`, `waiver-signatures`) gain client `storage.objects` policies.
- Extended `bun run db:audit:architecture` to fail if `auth` schema tables are directly granted to `anon` or `authenticated`.
- The migration is metadata-only and production-safe for existing data: it does not delete, move, or rewrite storage objects.

Local bootstrap hardening:

- Replaced the raw `supabase db reset --local --yes` package script with `scripts/local-dev/reset-supabase.mjs`.
- The wrapper preserves normal failures, but recovers from the known post-migration Storage `502` race only after confirming the latest migration is recorded locally and restarting the Supabase stack.
- `bun run supabase` now completes a full local replay, non-DV platform fixture seed, and health check through the current migration chain.
- Added `bun run db:test:redesign` as the full sequential merge gate for this work. It runs local Supabase replay, advisors, architecture/plugin audits, runtime-contract checks, submodule strict check, typecheck, lint, plugin login/API browser smoke, cron route smoke, and the remote-readiness audit without overlapping dev servers.
- Added `bun run db:audit:remote-readiness` as the final-state server-only readiness check. It now belongs in the default merge gate and should stay green for the normal non-DV platform path.

DV Speech & Debate plugin posture:

- The private registry now excludes `dv-speech-debate` by default.
- The private registry no longer imports or exports `dv-speech-debate`; `LETS_ASSIST_ENABLE_DV_PLUGIN=true` is intentionally ignored until the plugin backend is redesigned.
- `scripts/local-dev/seed-dvsd.mjs` now fails fast with a clear message if `plugin_data` is not exposed through the Supabase Data API.
- Runtime contract sync now omits DV completely in the normal registry path.
- `bun run plugin:test:registry` verifies default private plugins remain registered and `dv-speech-debate` stays absent even if `LETS_ASSIST_ENABLE_DV_PLUGIN=true`.
- Removed the unused browser-side plugin-data helper and made the remaining server helper fail closed unless an explicit legacy env flag is set.
- Added `bun run plugin:audit:data-access` to fail future client components or shared browser helpers that try to construct `plugin_data` queries directly.
- Added `bun run plugin:test:contracts` to sync registered plugin runtime contracts from the local registry into `public.plugin_runtime_contracts`, verify registered plugins have contracts, reject `plugin_data` declarations with `rls-client`, verify no data boundary allows `rls_allowed`, and verify all organizations have isolation profiles.
- `bun run db:audit:plugin-isolation` now fails if `anon` regains `plugin_data` schema usage/default privileges or if `authenticated` direct grants are reintroduced.
- `bun run plugin:submodules:check` verifies the private plugin submodule path, remote URL, expected `development` branch, and registry file. Strict mode is available with `bun run plugin:submodules:check:strict` before publishing and fails if the submodule is unpublished ahead of or behind `origin/development`.
- The private plugin submodule should point at the commit that removes DV from the registry during this takedown; publish the submodule commit before publishing the root gitlink.

### Phase 5: Remote Deployment

- Run local migration replay.
- Run local advisors and workflow tests.
- Use remote read-only MCP for advisors/logs after local validation.
- Apply migrations through the standard Supabase migration workflow, not ad hoc dashboard edits.

## Verification Checklist

- `bun run supabase`
- `bun run db:test:redesign`
- `supabase db advisors --local --output-format json`
- `bun run dev:test:cron`
- `bun run typecheck`
- `bun run db:audit:plugin-isolation`
- `bun run db:audit:architecture`
- `bun run db:audit:remote-readiness`
- `bun run plugin:audit:data-access`
- `bun run plugin:submodules:check`
- `bun run plugin:test:registry`
- `bun run plugin:test:contracts`
- `bun run plugin:test:isolation`
- Browser checks: login, organization settings, project signup, anonymous signup, plugin routes, avatar/logo delivery, certificate verification

Local verification result on 2026-07-01:

- `bun run db:test:redesign` passed end-to-end.
- Local Supabase advisors reported zero issues after replaying migrations through the latest local migration.
- Architecture audit, plugin isolation audit, plugin data access audit, registry gates, runtime contracts, strict private submodule check, typecheck, lint, plugin login/API browser smoke, cron route smoke, and remote-readiness audit completed successfully.
- Lint completed with warnings only; no lint errors blocked the gate.
- Follow-up warning cleanup replayed local Supabase through `20260701202252_add_remaining_fk_indexes_and_revoke_plugin_boundary_api_grants.sql`; local advisors still reported zero issues.
- The FK-index warning is resolved. Remaining architecture warnings are limited to org core/invitation/plugin install surfaces that still have active direct app call sites.
- Calendar/sheet sync, plugin data boundary, and organization data isolation profile direct authenticated grants are removed from the warning list.
- Storage/auth follow-up replayed local Supabase through `20260701202940_storage_auth_baseline_and_waiver_signature_bucket.sql`; local advisors still reported zero issues.
- Direct verification showed `data-exports`, `plugin_form_uploads`, and `waiver-signatures` are private with expected MIME/size limits; `waiver-signatures` and `data-exports` have no client storage policies; `auth` has no direct `anon`/`authenticated` table grants.

Merge gate for this branch:

- Keep remote writes disabled until the local gate passes.
- Commit the private plugin submodule separately if the DV manifest contract changes are included.
- Apply remote Supabase changes only through migrations after `bun run supabase`, local advisors, plugin audits, cron checks, remote-readiness, and typecheck pass.
- After remote migration, run remote advisors again and compare remaining warnings against this document before reducing grants.

## Open Work

- Capture remote MCP advisor output in a dated appendix once remote auth is available.
- Save a reviewed linked diff before any `supabase db pull`.
- Redesign DV Speech & Debate to use server-only plugin backends/RPCs/direct Postgres helpers before re-enabling DV database/browser fixtures.
- Decide which public flows move to views versus server-only APIs.
