# Private Plugin Development Guide

Private plugins use two repositories:

- The main Lets Assist repository owns the runtime host, platform control plane, database migrations, generated database types, CI, and deployment.
- `lib/plugins/private` is a Git submodule containing customer-specific plugin UI and domain services.

## Clone and update

```bash
git clone --recurse-submodules <main-repository-url>
cd lets-assist
git submodule update --init --recursive
```

CI must use recursive submodules and a credential that can read the private repository:

```yaml
- uses: actions/checkout@v4
  with:
    submodules: recursive
    token: ${{ secrets.PRIVATE_REPO_TOKEN }}
```

The main repository pins an exact submodule commit. A plugin release is incomplete until the private commit is pushed and the main repository pointer is updated.

## Change workflow

1. Implement and test inside `lib/plugins/private`.
2. Commit and push the private repository change.
3. Return to the main repository.
4. Add migrations, fixtures, generated types, host routes, and CI changes.
5. Commit the updated submodule pointer with the main-repository changes.

Do not leave the main branch pointing at an unpushed private commit.

## Plugin structure

```text
plugins/<plugin-key>/
├── plugin.tsx
├── index.ts
├── domain.ts
├── services/
├── components/
├── fixtures/
├── actions.ts
└── lifecycle.ts
```

- `plugin.tsx` defines the manifest and platform surfaces.
- `domain.ts` contains Zod contracts, enums, and typed identifiers.
- `services/` owns authorization-aware business operations.
- components call server actions/services and do not embed database policy.
- fixtures contain sanitized external-service captures.
- lifecycle handlers delegate to services rather than directly mutating tables.

## Platform contract

Every production plugin should declare its host integration contract in `plugin.tsx`:

- `routes`: custom organization routes under `/organization/[id]/plugins/[pluginKey]/...`.
- `surfaceAccess` and `behaviorAccess`: where the plugin renders UI or modifies host behavior.
- `backendCapabilities`: server actions, route handlers, cron jobs, webhooks, AI jobs, external APIs, or workflows the plugin owns.
- `dataAccess`: structured table/view/RPC dependencies with the intended access mode (`server-only`, `rls-client`, `public-read-model`, `rpc`, or `background-job`).
- `storageAccess`: bucket and path patterns the plugin reads or writes.
- `requiredScopes`: coarse platform permissions shown during install/review.

The host syncs registered plugin manifests into `public.plugin_runtime_contracts` for admin review and audit. Organization-specific routes can also be registered in `public.organization_plugin_routes` when a route should exist for one organization but not every installation of the plugin.

Direct browser access to `plugin_data` is deprecated. New plugin workflows should use server actions, narrow RPCs, or explicit read models declared in `dataAccess`; this keeps the plugin data schema server-only by default while still allowing reviewed public/plugin-specific surfaces.

For organization-specific custom UI, route definitions belong in the plugin manifest first, then optionally in `public.organization_plugin_routes` for per-organization overrides. This keeps custom routes, custom UI, backend capabilities, storage paths, and plugin-owned data under one reviewable contract instead of scattering customer-specific routes throughout the host app.

Production plugin registration should be explicit and database-driven. Use `public.plugins`, `public.plugin_runtime_contracts`, `public.organization_plugin_entitlements`, `public.organization_plugin_installs`, `public.organization_plugin_routes`, and `public.organization_plugin_data_boundaries` to decide what appears for each organization. Do not add per-plugin runtime environment flags for availability; inactive or redesigned plugins should be disabled in the catalog/install/boundary state.

## Database and migrations

All schema changes live in `supabase/migrations`. Seed files contain data only. Never use a baseline schema override to bypass the migration chain.

Create a migration:

```bash
supabase migration new <descriptive_name>
```

Verify from an empty local database:

```bash
export DV_LOCAL_TEST_PASSWORD='choose-a-local-only-password'
bun run dv:dev:reset
bun run dv:test:db
```

`plugin_data` is internal server-side plugin storage by default. Every table, view, and function requires an explicit security decision:

- enable RLS;
- scope rows by organization;
- scope seasonal records by season;
- distinguish self-service from staff transitions;
- prevent cross-household and cross-organization access;
- test storage object paths;
- make audit/ledger data append-only where required.

Ordinary workflows use authenticated RLS clients. Service-role clients are restricted to controlled maintenance, fixture generation, public one-time token handlers, and trusted background jobs.

For new tables, default to server-only access unless the manifest `dataAccess` contract explains why direct RLS client access or a public read model is required. Avoid adding new blanket `GRANT ... ON ALL TABLES IN SCHEMA plugin_data` behavior; grant only the narrow role/object access required by the declared contract.

When a plugin needs browser-visible or public data, create a narrow read model for that specific route or workflow. Prefer `WITH (security_invoker = true)` views on Postgres 15+ when the view should honor the caller's RLS. Keep base plugin tables tenant-owned with `organization_id`, foreign keys, and indexes that match the route's query pattern.

Every installed plugin should have a row in `public.organization_plugin_data_boundaries`. Regular organizations use `isolation_mode = 'shared'`; enterprise customers can be marked for `dedicated_schema`, `dedicated_project`, or `external` handling without changing the default install flow.

Use the admin plugin control plane's Data Boundaries tab to inspect installed plugin boundaries. A missing boundary row is a schema/process bug, not an expected state.

After migrations, regenerate Supabase types and use typed repositories. New plugin code must not introduce `any` casts to bypass schema typing.

## Local development

Start and verify the local stack:

```bash
bun run supabase:start
bun run dv:dev:health
```

Reset and seed deterministic DV data:

```bash
export DV_LOCAL_TEST_PASSWORD='choose-a-local-only-password'
bun run dv:dev:reset
```

The fixture script refuses non-local Supabase URLs. Local accounts, IDs, organizations, seasons, and scenarios are deterministic; passwords are supplied at runtime and never committed.

Run checks:

```bash
bun run dv:test:db
bun run db:audit:plugin-isolation
bun run plugin:test:isolation
bun test ./lib/plugins/private/plugins/dv-speech-debate/services
bun run dv:test:e2e
bun run lint
bun run typecheck
bun run build
```

External services use fixtures by default. Live tests require an explicit command and environment switch:

```bash
DV_TABROOM_TOURNAMENT_ID=12345 bun run dv:tabroom:smoke
```

## CI order

CI should:

1. Check out recursive submodules.
2. Install a pinned Bun and Supabase CLI version.
3. Install dependencies from the lockfile.
4. Start local Supabase.
5. Replay migrations and seed deterministic fixtures.
6. Run RLS/database integration tests.
7. Run unit tests, lint, typecheck, and production build.
8. Install the pinned Playwright browser and run plugin journeys.
9. Stop local services even when a previous step fails.

Live Tabroom, Resend, or other third-party calls are excluded from normal CI.

## UI and dependency upgrades

Upgrade compatible patches/minors together, then verify typecheck, build, and browser tests. Handle breaking majors independently.

For shadcn:

```bash
bunx --bun shadcn@latest add --all --dry-run
bunx --bun shadcn@latest add <component> --diff
```

Review every installed component and preserve local APIs/customization. Do not use blanket overwrite.

For Next.js, review Server Component boundaries, async route APIs, Server Actions, server-side permission checks, and client bundle growth.

## Release and rollback

Before release:

- migrations replay from empty;
- all local and CI checks pass;
- the private commit is pushed;
- the main repository points to that exact commit;
- no credentials or production-capable local env files are committed;
- schema changes are backward-compatible with the currently deployed plugin during rollout.

Version the plugin manifest intentionally and record migration compatibility. Database migrations are forward-only in production; rollback means redeploying a compatible application revision or shipping a corrective migration. Never delete a migration that may have run remotely.

To roll back plugin code:

1. Select a prior known-good private commit compatible with the deployed schema.
2. Update the main repository submodule pointer.
3. Run build and focused workflow tests.
4. Deploy the main revision.
5. If data correction is required, add a reviewed forward migration or maintenance script with an audit trail.

## Security checklist

- Server actions revalidate identity, organization role, and current state.
- Consequential transitions create immutable audit events.
- One-time links store token hashes, expire, and consume atomically.
- Upload paths include organization and user scope and have tested storage policies.
- External payloads are validated and raw snapshots are retained where required.
- AI output is untrusted input and is revalidated before staff approval.
- Recipient previews and idempotency are required before communication jobs are queued.
