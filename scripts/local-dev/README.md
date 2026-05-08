# Local Dev Seed README

This folder contains scripts used to provision a predictable local Supabase testing environment.

## Files

- `bootstrap-auth-user.mjs`
  - Creates/updates your primary local login account and profile metadata.
- `bootstrap-dev-accounts.mjs`
  - Creates reusable persona accounts in local `auth.users` + `public.profiles`.
- `seed-dummy-orgs.mjs`
  - Creates dummy organizations, memberships, projects, signups, and certificates for role-based org scenarios.
- `member-import-mock.csv`
  - 10-row sample file for testing organization member CSV import, including phone numbers and notes.

## Recommended workflow

Run from repository root:

1. `bun run supabase:reset`
2. `bun run supabase:bootstrap:auth`
3. `bun run supabase:seed:local-dev`

This gives you:

- your platform admin account
- multiple test personas
- seeded organizations, memberships, projects, signups, and certificates for role-based flow testing

## Where account credentials are documented

See: `docs/local-dev-accounts.md`
