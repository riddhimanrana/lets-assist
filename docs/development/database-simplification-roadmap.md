# Database Simplification Roadmap (Supabase)

Date: 2026-04-11

## What was already fixed in this pass

- Removed legacy waiver template concept from runtime + admin wording:

  - app now uses `waiver_definitions` as canonical waiver source.
  - removed runtime reads/writes of `waiver_templates` and `waiver_template_id`.

- Added migration to remove legacy waiver schema:

  - `supabase/migrations/20260411173000_simplify_waiver_model_and_harden_rls.sql`

- Included advisor hardening in migration set:

  - fixed `search_path` hardening for key functions
  - added explicit `banned_emails` deny policy under RLS
  - added missing FK indexes for flagged constraints

## Domain-by-domain simplification assessment

### 1) Waivers (currently multiple tables)

Current model:

- `waiver_definitions` (document/version metadata)
- `waiver_definition_signers` (roles)
- `waiver_definition_fields` (mapped fields)
- `waiver_signatures` (captured signing events)
- legacy: `waiver_templates` (deprecated)

Assessment:

- **Not inherently over-normalized** for a multi-signer PDF-aware waiver system.
- The old redundancy was from supporting both `waiver_templates` and `waiver_definitions` simultaneously.

Action:

- Keep the 4-table definition/signature model.
- Remove `waiver_templates` permanently (implemented in migration).

### 2) `user_emails` vs auth users

Assessment:

- Keeping email history/aliases/verification status in app tables can be valid.
- `auth.users` should remain identity source, but app-level email policy/history often belongs in `public`.

Action:

- Keep separate table **if** it stores behavior not available in `auth.users` (history, primary/secondary state, moderation metadata).
- If not, collapse to a view over `auth.users` + minimal extension table.

### 3) `banned_emails`

Assessment:

- Separate moderation table is appropriate; do not overload `auth.users` with moderation-only records.

Action:

- Keep table, enforce explicit deny-all client RLS policy (implemented).
- Keep server-side checks via service-role or trusted RPC.

### 4) Plugins / calendars (`organization_plugin_*`, `organization_calendar_*`)

Assessment:

- `installs` and `entitlements` can be merged if there is no independent lifecycle.
- split is only justified when billing/entitlement state must be auditable separately from install state.

Action:

- Evaluate merge into single `organization_plugins` table with:

  - `status`, `enabled`, `plan`, `expires_at`, `metadata`

- Keep separate only if billing/audit/legal reasons require strict separation.

### 5) `content_flags` vs `content_reports`

Assessment:

- Usually **can** be unified into one moderation events table with `event_type`.
- Split can be justified if reports are user-originated and flags are system/admin-originated with very different retention/workflows.

Action:

- If query paths overlap heavily, merge into `content_moderation_events`.
- If keeping separate, create a unifying read model view for admin UI.

### 6) `account_data_export_jobs` vs `account_data_export_audit_logs`

Assessment:

- This split is usually correct (job queue/state vs append-only audit trail).

Action:

- Keep split.
- Optionally archive older audit rows to reduce hot-table size.

## RLS and advisor debt strategy

### What to fix first

1. Any RLS policy with auth/current_setting evaluated per-row:

   - convert `auth.uid()` -> `(select auth.uid())`
   - same pattern for auth role helpers/current_setting.

2. Consolidate overlapping permissive policies per action/role.
3. Add missing FK indexes.
4. Drop truly unused indexes only after workload observation period.

### Why so many “unused index” findings appeared

- Local/dev workloads are often too small to exercise planner paths.
- Do **not** mass-drop indexes from a single snapshot.

Safe approach:

- Keep candidate list.
- verify with production-like traffic window.
- remove in small batches with rollback migration.

## Proposed staged plan

### Phase A (done in this pass)

- Remove waiver template legacy path.
- Harden immediate security/performance findings around search_path + banned_emails + missing FK indexes.

### Phase B (done)

- Rewrite remaining RLS policies flagged for initplan usage (auth/current_setting wrappers).
- Merge duplicate permissive policies on waiver tables and adjacent domains.

### Phase C (in progress)

- Added read-model consolidation migration:

  - `supabase/migrations/20260411213000_phase_c_consolidation_read_models.sql`

- Introduced non-breaking consolidated views:

  - `public.organization_plugin_access` (catalog + install + entitlement)
  - `public.content_moderation_events` (flags + reports event stream)

- Updated app read paths (with fallback for environments where views are not yet deployed):

  - `lib/plugins/resolve-org-plugins.ts` now reads `organization_plugin_access` first
  - `app/admin/moderation/actions.ts#getModerationStats` now reads `content_moderation_events` first

- Phase C cutover step 2 additions:

  - `supabase/migrations/20260411223000_phase_c_cutover_step2_plugin_access_view.sql`
  - broadened `organization_plugin_access` to include org+plugin rows sourced from installs **or** entitlements
  - cut over additional plugin read paths to the consolidated view:

    - `lib/plugins/resolve-plugin-behaviors.ts`
    - `lib/plugins/resolve-plugin-surfaces.ts`
    - `app/organization/[id]/settings/actions.ts#getOrganizationPluginSettings`
    - `app/admin/plugins/actions.ts#getPluginControlPlaneData`

- Validation after Phase C step 2 run:

  - advisor output unchanged for security/perf classes fixed in Phase B
  - remaining findings still `unused_index` (62)

### Phase C (next cutover steps)

- Domain consolidation decision:

  - keep writes on base tables, then progressively move moderation list/feed reads onto `content_moderation_events`
  - introduce explicit compatibility contracts for eventual physical table merge (views + triggers/backfill)

### Phase D

- Index cleanup after observation:

  - remove confirmed-unused indexes only after query/traffic validation.

## Guardrails for this repository

- Keep local-first Supabase workflow (`bun run supabase:reset` as gate).
- Track all schema changes in `/supabase/migrations`.
- After remote deployment, refresh baseline snapshot before broader cleanup phases.

## Current local advisor status (after Phase B run)

- `duplicate_index`: 0
- `auth_rls_initplan`: 0
- `multiple_permissive_policies`: 0
- `function_search_path_mutable`: 0
- `rls_enabled_no_policy`: 0
- `unindexed_foreign_keys`: 0
- Remaining findings: `unused_index` (63, info-level)

Note: The remaining `unused_index` findings should be handled with workload observation first (production-like traffic), then pruned in small reversible batches.
