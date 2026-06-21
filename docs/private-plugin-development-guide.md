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

`plugin_data` is an exposed PostgREST schema. Every table, view, and function requires an explicit security decision:

- enable RLS;
- scope rows by organization;
- scope seasonal records by season;
- distinguish self-service from staff transitions;
- prevent cross-household and cross-organization access;
- test storage object paths;
- make audit/ledger data append-only where required.

Ordinary workflows use authenticated RLS clients. Service-role clients are restricted to controlled maintenance, fixture generation, public one-time token handlers, and trusted background jobs.

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
