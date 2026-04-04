# Copilot Instructions — lets-assist

## Local-first Supabase workflow (required)

- Treat **local Supabase CLI** as the default development database.
- Do **not** make direct schema/data changes against hosted production from local feature work.
- Use project scripts for local DB lifecycle:
  - `bun run supabase:start`
  - `bun run supabase:status`
  - `bun run supabase:reset`
  - `bun run supabase:dump:schema`
  - `bun run supabase:dump:seed`
- Keep `NEXT_PUBLIC_SUPABASE_URL` in local development pointed to `http://127.0.0.1:54321` unless explicitly using hosted environments.

## Database change rules

- Before changing DB structure, ensure local Supabase is healthy and resettable (`bun run supabase:reset`).
- For schema updates in this repo, preserve the current baseline local bootstrap mode in `supabase/config.toml` unless explicitly migrating strategy.
- If adding/adjusting SQL artifacts, verify local replay succeeds from a clean reset.
- Never commit secrets (service-role keys, OAuth secrets, API tokens).

## Auth and Google OAuth (local)

- Local Google auth depends on both:
  - App env in `.env.local`
  - Supabase runtime env in `supabase/.env.local`
- Keep Supabase Google provider callback consistent with local setup:
  - `http://localhost:54321/auth/v1/callback`
- If Google login fails with `redirect_uri_mismatch`, instruct to update Google Cloud OAuth client authorized redirect URIs to exact match.

## Branching model (required)

- Feature work starts from `development`.
- Open PRs into `development` first.
- Promote `development` into `main` via PR after validation.
- Avoid direct commits to `main` except for urgent hotfix procedures.

## Quality gates before merge

- Minimum local checks before opening PR:
  - `bun run typecheck`
  - `bun run supabase:reset` for DB-impacting changes

## CI/CD expectations

- PR CI should run lint/typecheck.
- DB-impacting PRs should include migration/schema artifact validation via local reset semantics.
- Production workflows should run from `main` only.
- Scheduled cron workflows should continue targeting deployed app endpoints (as already configured in `.github/workflows`).

## Database workflow (local-first with diff-based migrations)

- **Local setup**: Baseline snapshot mode (`[db.migrations].enabled = false`)
  - `supabase db reset` loads from `schemas/remote_baseline_schema.sql` (fast, reproducible)
  - No replay of legacy 60+ migrations — start from finished schema state
- **Schema changes**: Use diff-based migration approach
  1. Make changes locally in Supabase Studio (`localhost:54321`)
  2. Generate migration from diff: `supabase db diff --linked -f my_feature_name`
     - Creates `supabase/migrations/20260325_my_feature_name.sql`
  3. Review the generated migration file
  4. Push to repo and open PR
  5. CI validates: `bun run supabase:reset` + typecheck
  6. **Deploy to remote** (after PR approval):
     ```bash
     supabase db push --linked
     ```
- **Stay in sync after remote changes**:
  ```bash
  bun run supabase:dump:schema  # Pull latest baseline
  bun run supabase:reset        # Reset local to new baseline
  ```
- Never commit schema changes without migrations tracked in `/supabase/migrations/`

## Agent behavior expectations

When editing this repository, prioritize:

1. Safety of production data
2. Reproducibility of local setup
3. Branch-discipline (`feature -> development -> main`)
4. Clear docs for any new environment requirement
