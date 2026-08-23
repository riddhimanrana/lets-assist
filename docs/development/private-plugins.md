# Private Plugin Development Guide

Private plugins use two repositories:

- The main Lets Assist repository owns the runtime host, platform control plane, database migrations, generated database types, CI, and deployment.
- `lib/plugins/private` is a Git submodule containing customer-specific plugin UI and domain services.

## Clone and update

```bash
git clone --recurse-submodules <main-repository-url>
cd lets-assist
bun run plugin:submodules:init
```

Run the complete local plugin gate with one command:

```bash
bun run plugin:verify
```

It checks gitlink drift, the host-import boundary, versioned SDK,
signed-release integration, embedded private tests, and every independent
application package. Each application package gets a frozen credential-free
install followed by lint, typecheck, tests, build, data-access audit, and route
inventory.

During active private-plugin development, gitlink drift and private working-tree
changes are reported as warnings so the remaining gates still run. Run the
exact publication gate only after the root index points at the private commit
you intend to publish:

```bash
bun run plugin:verify:strict
```

Before creating a private release tag, run `bun run plugin:verify`. The signed
release workflow verifies the reviewed private source, and the root integration
then runs the strict gate after it updates the gitlink for an embedded release.

Pull requests run the short static and plugin-contract check. Merging to
`development` does not repeat the full database and browser suite. Run the
manual `Code quality` workflow only for a hosted full rehearsal; Production
schema deployment has its own exact reset and pgTAP gate.

CI checks out the exact committed private gitlink with the repository-scoped
`PRIVATE_SUBMODULE_SSH_KEY`. It does not use a reusable personal access token.

The main repository pins an exact submodule commit. A plugin release is incomplete until the private commit is pushed, the main repository pointer is updated, and an immutable `plugin_versions` release record pins the commit, source tree, declared release inputs, and their content digest. A manifest hash alone does not identify all code that runs.

## Routine change workflow

1. Implement and test inside `lib/plugins/private`.
2. Run `bun run plugin:verify` from the platform root.
3. Commit and merge the private change into private `development`.
4. For an ordinary embedded change, update the root gitlink through a root
   pull request. For a versioned release, promote the private commit to private
   `main` and create the plugin-scoped release tag. The signed release workflow
   verifies the source and opens the root integration pull request for you.
5. Merge the root integration into `development` after its short checks pass.
   Run a full hosted rehearsal only when the change or release risk calls for
   it.

Application publication, deployment, organization installation, and runtime
activation remain separate. This keeps each step reversible and prevents a
new release from moving an organization automatically.

For storage, use the private `plugins` bucket and namespace every object as
`{organizationId}/{pluginKey}/...`. The manifest must declare each live path
pattern as `server-only`; plugin code must use a shared path builder instead of
assembling bucket names or tenant prefixes ad hoc.

Browser-assisted form uploads use `plugin_form_uploads` instead, with exact
paths `{organizationId}/{pluginKey}/{userId}/{file}`. RLS verifies every scope
segment and that the organization has the plugin enabled. Do not reuse that
browser path for server-managed plugin artifacts.

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

An independently deployed application profile uses a separate package:

```text
apps/<app>/
├── package.json
├── bun.lock
├── app/
├── src/
├── scripts/
└── tests/
```

The package must pin the same Bun version as the platform and define `lint`,
`typecheck`, `test`, `build`, `audit:data-access`, and `inventory:routes`.
Run `bun run plugin:apps:check` from the platform checkout to install and verify
every child package. Host tooling deliberately excludes `apps/**` only because
this replacement gate runs in root CI and in the existing private-candidate
test path.

`bun run dev` also supports a fresh initialized submodule. If the CSF child has
no local Next executable, the isolated runner installs its own frozen lockfile
with lifecycle scripts disabled and a disposable credential-free home. It then
starts both application runtimes directly through Node in the bounded local
environment.

An application profile consumes the published plugin SDK package. It cannot use
host `@/app`, `@/components`, `@/lib`, or `@/services` imports. It shares the
environment's Supabase Auth session through the main-domain request, uses only
the publishable key to refresh and verify that session, and repeats current
entitlement, install, organization membership, and plugin-role checks inside
its server data boundary. Do not configure `SUPABASE_SERVICE_ROLE_KEY` or
`SUPABASE_SECRET_KEY` in the child project.

For every server-rendered application request:

1. Create a request-scoped Supabase SSR client from the public URL,
   publishable key, and request cookies.
2. Verify the caller with `auth.getUser()`. Do not authorize from an unverified
   cookie or decoded token alone.
3. Call `get_plugin_application_access_context_by_identifier` with the requested
   organization UUID or route username, exact plugin key, and exact child build
   version.
4. Call the plugin-specific role projection when the route needs role facts.
5. Render only the narrow caller-scoped result. Treat a missing, malformed, or
   denied proof as inaccessible.

The host resolves an application page with
`get_plugin_application_route_target_by_identifier`, then rewrites it to the
exact healthy immutable Vercel deployment selected for the organization and
environment. The host accepts only HTTPS `*.vercel.app` targets returned by the
database. It removes any caller-supplied deployment-protection bypass header
and, when configured, supplies the trusted bypass value only on the upstream
request.

The host route, microfrontend project claim, and organization identifier are
routing inputs, not authorization. Vercel's project-level microfrontend route
cannot select different immutable releases for different organizations, so it
must not claim the versioned application page. Child reads and mutations repeat
the caller-proof sequence on every request. Consequential plugin operations use
their existing server-only transactions and recheck capability after taking
the required locks.

SDK releases use the `plugin-sdk/v<version>` Git tag family in the public
repository. The release workflow accepts a tag only when it matches the stable
version in `packages/plugin-sdk/package.json` and the tagged commit belongs to
Development. It packages the SDK with Bun, creates a CycloneDX SBOM, binds both
files and their source inputs into a release manifest, and signs that manifest
with GitHub Actions OIDC through Cosign. A child package pins the immutable
GitHub Release tarball and commits the resulting `bun.lock`. Do not copy
`lib/plugins/sdk` into a child or depend on an unversioned branch URL.

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

Reviewed browser workflows use authenticated RLS clients only on public API
surfaces. Private plugin domain data uses server actions or narrow RPCs with
fresh authorization and organization scope. Service-role clients are restricted
to those checked server boundaries, controlled maintenance, fixture generation,
public one-time token handlers, and trusted background jobs.

For new tables, default to server-only access unless the manifest `dataAccess` contract explains why direct RLS client access or a public read model is required. Avoid adding new blanket `GRANT ... ON ALL TABLES IN SCHEMA plugin_data` behavior; grant only the narrow role/object access required by the declared contract.

When an application plugin needs browser-visible data, return a narrow DTO from
its server boundary after fresh session and tenant authorization. Do not expose
CSF domain tables or a new PostgREST schema to make an application route work.
Keep base plugin tables tenant-owned with `organization_id`, foreign keys, and
indexes that match the route's query pattern.

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

Treat publication, deployment, and installation as different steps. Publishing
a release does not prove that any deployment contains it, and observing a
process start does not prove that deployment is healthy. An embedded plugin
ships only when the root platform deployment contains its pinned private tree.
An application plugin also needs its independently built artifact, SBOM, and
deployment identity.

New releases declare every repository-relative `releaseInput` whose bytes form
the program. Embedded releases include their plugin subtree. Application and
service releases also include the child application and dependency lockfile.
Release tooling must hash that complete set and verify exact tree equality, not
only that the source commit is an ancestor.

Before release:

- migrations replay from empty;
- all local and CI checks pass;
- the private commit is pushed;
- the main repository points to that exact commit;
- the release input digest and compatibility ranges match the reviewed source;
- no credentials or production-capable local env files are committed;
- schema changes are backward-compatible with the currently deployed plugin during rollout.

Version the plugin manifest intentionally and record migration compatibility. Database migrations are forward-only in production; rollback means redeploying a compatible application revision or shipping a corrective migration. Never delete a migration that may have run remotely.

To roll back plugin code:

1. Select a prior known-good private commit compatible with the deployed schema.
2. Update the main repository submodule pointer.
3. Run build and focused workflow tests.
4. Deploy the main revision.
5. If data correction is required, add a reviewed forward migration or maintenance script with an audit trail.

Do not advance `organization_plugin_installs.installed_version` from a schema
migration. Record the operator's desired version, run the leased update
lifecycle, recheck authorization under the lease, and persist the activation
through the reviewed control-plane path. Automatic updates remain disabled.

## Security checklist

- Server actions revalidate identity, organization role, and current state.
- Consequential transitions create immutable audit events.
- One-time links store token hashes, expire, and consume atomically.
- Upload paths include organization and user scope and have tested storage policies.
- External payloads are validated and raw snapshots are retained where required.
- AI output is untrusted input and is revalidated before staff approval.
- Recipient previews and idempotency are required before communication jobs are queued.
