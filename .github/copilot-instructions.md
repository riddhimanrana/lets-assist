# Copilot Instructions — lets-assist

## What this repository is

This repo is a Next.js application built with the new App Router. It uses:

- Supabase for database, auth, storage, and edge functions
- A local-first dev experience with a Supabase CLI local instance
- TypeScript, ESLint, and custom components under `components/`
- Supabase schema migrations in `supabase/migrations/`

The app is intended to run locally with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` and a local Supabase instance for development.

## Local vs remote Supabase usage

- Local copilot agents should assume the local Supabase development environment.
  - Use `bun run supabase:start`, `bun run supabase:status`, `bun run supabase:reset`, etc.
  - Keep `NEXT_PUBLIC_SUPABASE_URL` pointed at `http://127.0.0.1:54321` for local work.
- Remote copilot agents or deployed environments should use the hosted Supabase project URL and runtime config from the deployment environment.
  - Do not hardcode local URLs for remote agents.
  - Use environment variables supplied by deployment when resolving Supabase connection values.

## Supabase database workflow

- The repo uses a local-first workflow with a baseline schema snapshot.
- Local database resets should be performed with:
  - `bun run supabase:reset`
- Schema changes should be generated using diff-based migrations, not manual edits of the baseline snapshot.
- After remote schema changes are finalized, update local baseline with:
  - `bun run supabase:dump:schema`
  - `bun run supabase:reset`

### Change rules for DB artifacts

- Do not make schema or data changes directly against hosted production from local feature work.
- Preserve the current Supabase local bootstrap mode in `supabase/config.toml` unless there is an explicit repo-wide migration strategy change.
- If you add or change SQL artifacts, verify the change by resetting the local DB from a clean state.
- Never commit secrets, service-role keys, OAuth secrets, or API tokens.

## Auth and OAuth guidance

- Local Google auth depends on both:
  - `.env.local` for app config
  - `supabase/.env.local` for Supabase runtime config
- Maintain the configured local callback URI for Google auth when working locally.
- If login issues occur, verify callback URIs and environment config before changing code.

## Repository conventions

- Feature branches should be based on `development`.
- Open pull requests into `development` first.
- Promote `development` into `main` only after validation.
- Avoid direct commits to `main` except for urgent hotfix procedures.

## Quality and CI expectations

- Local checks before opening a PR:
  - `bun run typecheck`
  - `bun run supabase:reset` for DB-impacting changes
- PR CI should run lint and typecheck.
- DB-impacting PRs should include migration/schema artifact validation using local reset semantics.
- Production workflows should run from `main` only.
- Scheduled cron workflows and deployed services should target live endpoints, not local dev hostnames.

## Local schema change process

1. Make schema changes in local Supabase Studio at `http://localhost:54321`.
2. Generate a migration with the diff-based workflow.
3. Review the generated SQL migration under `supabase/migrations/`.
4. Push the migration and open a PR.
5. Validate with `bun run supabase:reset` + `bun run typecheck`.
6. After PR approval, deploy remote schema changes using the approved remote Supabase workflow.

## Agent behavior expectations

When editing this repository, prioritize:

1. Safety of production data
2. Reproducibility of local setup
3. Branch discipline (`feature -> development -> main`)
4. Clear documentation for new environment requirements
