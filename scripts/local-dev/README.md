# Local Dev Setup

This folder contains the deterministic fixtures and health checks for the local Supabase + Next.js workflow.

## What to run

From the repository root:

1. Create a run-scoped fixture password: `export CSF_LOCAL_TEST_PASSWORD="$(openssl rand -base64 24)"`
2. Reuse it for the optional DV fixtures: `export DV_LOCAL_TEST_PASSWORD="$CSF_LOCAL_TEST_PASSWORD"`
3. `bun run supabase`
4. `bun run dev`

`bun run supabase` does the full backend bootstrap:

- starts local Supabase
- resets the database through the current migrations
- seeds deterministic non-DV platform test accounts, organizations, plugin installs, and projects
- verifies the local Supabase environment is reachable

The reset step uses `scripts/local-dev/reset-supabase.mjs`. It behaves like
`supabase db reset --local --yes`, except it can recover from the Supabase CLI
post-reset Storage `502` race after verifying the latest migration was recorded
and restarting the local stack.

## Isolated DVHS CSF browser stack

Use the isolated launcher when Vela or another workspace is already using the
shared Supabase ports:

1. Export the two run-scoped fixture-password variables shown above.
2. Run `scripts/local-dev/start-dvhs-csf-isolated-stack.sh` and copy the exact
   work directory it prints.
3. Source `<work-directory>/supabase-browser.env`, then run
   `bun run supabase:seed:local-dev` to create fictional login accounts.
4. Source `<work-directory>/lets-assist-browser.sh`, then run
   `bun run dev -- --port 3001`.
5. Stop only that namespaced stack with
   `scripts/local-dev/stop-dvhs-csf-isolated-stack.sh <work-directory>`.

The launcher never starts, stops, or resets the shared Vela Supabase project.

## Useful follow-up checks

- `bun run db:test:redesign` to run the full sequential Supabase/plugin redesign merge gate
- `bun run dv:test:db` to verify local RLS and schema behavior
- `bun run dv:test:e2e` to run the Playwright DV browser checks
- `bun run dev:test:cron` to exercise the cron routes that mirror GitHub Actions
- `bun run db:advisors` to verify local Supabase advisor output stays clean after migrations
- `bun run db:audit:architecture` to verify tenant indexes/FKs, RLS policy hygiene, and read-model view safety
  - Also hard-fails unexpected client-executable public `SECURITY DEFINER` functions while printing the reviewed allowlist.
  - Also verifies expected Storage buckets, public/private bucket posture, and absence of public/anon object-listing policies.
- `bun run db:audit:remote-readiness` to check the stricter final production posture where `plugin_data` is removed from exposed Data API schemas and authenticated direct grants are gone
  - This is expected to fail during the current transition while server-side plugin code still uses Supabase schema builders for `plugin_data`.
- `bun run plugin:audit:data-access` to verify browser/client code cannot directly construct `plugin_data` queries
- `bun run plugin:test:registry` to verify every private plugin registry gate, including the server-only DV workspace
- `bun run plugin:test:contracts` to sync registered plugin runtime contracts and verify no plugin declares raw `plugin_data` client access
- `bun run typecheck` to verify generated read-model usage still matches the app

## Fixture files

- `README-fixtures.md` documents seeded accounts and the required run-scoped
  credential environment variables
- `member-import-mock.csv` is a sample import file for org member CSV testing
- `seed-platform.mjs` contains the default local platform seed logic
- `seed-dvsd.mjs` provisions the optional DV workspace through a service-role-only backend client; browser roles have no `plugin_data` grants

## Supabase redesign gate

Before merging Supabase schema changes:

1. Export fresh `CSF_LOCAL_TEST_PASSWORD` and `DV_LOCAL_TEST_PASSWORD` values,
   then run `bun run supabase`
2. `bun run db:advisors`
3. `bun run plugin:submodules:check`
4. `bun run db:audit:plugin-isolation`
5. `bun run db:audit:architecture`
6. `bun run plugin:audit:data-access`
7. `bun run plugin:test:registry`
8. `bun run plugin:test:contracts`
9. `bun run plugin:test:isolation`
10. `bun run dev:test:cron`
11. `bun run typecheck`
12. `bun run db:audit:remote-readiness`

Run browser/dev-server checks sequentially. Next.js allows only one dev server per project directory, so `bun run plugin:test:isolation` and `bun run dev:test:cron` should not run in parallel.

Remote Supabase writes should wait until the local gate passes and the generated migration has been reviewed.

`bun run db:test:redesign` is the current local merge gate and now includes `bun run db:audit:remote-readiness`. DV Speech & Debate is registered again after its browser-facing data access was replaced with authenticated Server Actions and service-role-only backend reads.
