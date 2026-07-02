# Local Dev Setup

This folder contains the deterministic fixtures and health checks for the local Supabase + Next.js workflow.

## What to run

From the repository root:

1. `bun run supabase`
2. `bun run dev`

`bun run supabase` does the full backend bootstrap:

- starts local Supabase
- resets the database through the current migrations
- seeds deterministic non-DV platform test accounts, organizations, plugin installs, and projects
- verifies the local Supabase environment is reachable

The reset step uses `scripts/local-dev/reset-supabase.mjs`. It behaves like
`supabase db reset --local --yes`, except it can recover from the Supabase CLI
post-reset Storage `502` race after verifying the latest migration was recorded
and restarting the local stack.

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
- `bun run plugin:test:registry` to verify private plugin registry gates, including DV hard-disabled while its backend is redesigned
- `bun run plugin:test:contracts` to sync registered plugin runtime contracts and verify no plugin declares raw `plugin_data` client access
- `bun run typecheck` to verify generated read-model usage still matches the app

## Fixture files

- `README-fixtures.md` documents the seeded accounts and passwords
- `member-import-mock.csv` is a sample import file for org member CSV testing
- `seed-platform.mjs` contains the default local platform seed logic
- `seed-dvsd.mjs` is temporarily disabled because `plugin_data` is no longer exposed through the Supabase Data API

## Supabase redesign gate

Before merging Supabase schema changes:

1. `bun run supabase`
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

`bun run db:test:redesign` is the current local merge gate and now includes `bun run db:audit:remote-readiness`. DV Speech & Debate is intentionally down until its plugin backend is redesigned for server-only access.
