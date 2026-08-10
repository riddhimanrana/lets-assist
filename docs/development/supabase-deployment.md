# Supabase Schema Deployment Pipeline

Safe, validated CI/CD for Supabase database migrations with comprehensive safety checks.

## Overview

This pipeline ensures that all schema changes are:

- ✅ **Validated** — migration file naming and formats checked, plus a risky-pattern grep
- ✅ **Tested** — replayed locally to catch issues early
- ✅ **Audited** — security and performance advisors run
- ✅ **Safe** — dry-run before production deployment
- ✅ **Reversible** — trackable via git commits

## Quick Start

### Local Validation (Before Pushing)

```bash
# Comprehensive validation
# - Checks migration file formats
# - Verifies timestamps are unique
# - Tests migrations replay locally
bun run db:validate
```

### Dry-Run Check (Before Production Deploy)

```bash
# See what would be deployed WITHOUT making changes
# Requires: SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_ID
bun run db:dry-run
```

### Security & Performance Advisors

```bash
# Check for security vulnerabilities and performance issues
# Requires: local Supabase running
bun run db:advisors
```

## Workflow

### 1. **Local Development**

Make schema changes in local Supabase Studio:

```bash
# Start local Supabase
bun run supabase:start

# Access at: http://localhost:54321
# Studio: http://localhost:54323
```

### 2. **Generate Migrations**

After making changes in Studio, generate a migration file:

```bash
# Pull changes and create a new migration
supabase db pull -d <migration_name>
```

Migration files go in `supabase/migrations/` with format:

```
YYYYMMDDHHMMSS_migration_name.sql
```

### 3. **Validate Locally**

Before committing, validate the migration:

```bash
# This will:
# ✓ Check file format
# ✓ Test migration replay
# ✓ Verify no conflicts
bun run db:validate
```

### 4. **Commit & Push**

Once validation passes:

```bash
# Commit to development branch
git add supabase/migrations/
git commit -m "Add schema changes: <description>"
git push origin development

# Create PR: development → main
# GitHub Actions will automatically run full validation
```

### 5. **CI on Main, and the manual production gate**

> **Merging to `main` does not deploy the schema.** A push to `main` that touches
> `supabase/migrations/**` or `supabase/config.toml` runs validation only. The
> `deploy-to-production` job in `.github/workflows/deploy-schema.yml` runs **only**
> on a manual `workflow_dispatch`, only from `refs/heads/main`, and only when the
> `production_confirmation` input exactly matches
> `deploy-production:fotdmeakexgrkronxlof`. It then verifies the target project
> ref twice, dry-runs, pushes, and checks migration-ledger parity.
>
> The real safeguard is stronger than automation would be. Treat production
> schema deployment as a deliberate, authorized act.

When your PR merges to `main`, GitHub Actions automatically:

1. ✅ **Validates Migrations**
   - Checks file naming conventions
   - Verifies no duplicate timestamps
   - Scans for risky SQL patterns (`SELECT *`, `WHERE 1=1`, `-- UNSAFE`).
     This is a grep, not a parser — it does not validate SQL syntax.

2. ✅ **Tests Locally**
   - Runs `supabase db reset` to replay all migrations
   - Ensures migrations work from scratch

3. ✅ **Runs Advisors**
   - Security checks (RLS policies, exposed functions, etc.)
   - Performance analysis (missing indexes, etc.)

4. ✅ **Deploys to Production**
   - Links to remote database
   - Shows pending changes
   - Dry-run validation
   - Applies migrations
   - Verifies success

## Manual Production Deploy

If you need to manually deploy without a PR:

```bash
# 1. Set credentials (if not already in environment)
export SUPABASE_ACCESS_TOKEN="sbp_xxxxxxxxxxxxx"
export SUPABASE_PROJECT_ID="your-project-id"

# 2. Test first with dry-run
bun run db:dry-run

# 3. Deploy (if dry-run passed)
supabase link --project-ref $SUPABASE_PROJECT_ID
supabase db push --linked --yes
```

## Safety Features

### Validation Checks

| Check                 | Local Validate | CI/CD | Purpose                             |
| --------------------- | -------------- | ----- | ----------------------------------- |
| File format check     | ✓              | ✓     | Catch naming errors early           |
| Duplicate timestamps  | ✓              | ✓     | Prevent migration conflicts         |
| Migration replay test | ✓              | ✓     | Ensure migrations work from scratch |
| Risky-pattern grep    | ✗              | ✓     | Flags `SELECT *`, `WHERE 1=1`, `-- UNSAFE`. Not a syntax check |
| Security advisors     | ✓              | ✓     | Find RLS/exposure issues            |
| Performance advisors  | ✓              | ✓     | Identify missing indexes            |
| Dry-run check         | ✓              | ✓     | Preview prod changes safely         |

### Blocking Conditions

The CI/CD pipeline **rejects deployment** if:

```
❌ Migration file format invalid
❌ Naming collision or duplicate timestamp
❌ Migration replay fails locally
❌ Security advisor critical issues
❌ Production deployment dry-run fails
```

### Reversibility

All changes are tracked in git:

```bash
# Review what changed
git diff main development -- supabase/migrations/

# See deployment history
git log --oneline main -- supabase/migrations/

# Revert if needed (creates new migration)
# Never force-push main with broken migrations
```

## Environment Setup

### GitHub Secrets (Required for CI/CD)

Set these in GitHub repository settings → Secrets and variables:

```bash
SUPABASE_PROJECT_ID        # Your Supabase project ID
SUPABASE_ACCESS_TOKEN      # Personal access token from Supabase
```

Get the access token:

1. Go to https://app.supabase.com/account/tokens
2. Click "Create new token"
3. Copy the token
4. Add to GitHub as `SUPABASE_ACCESS_TOKEN`

### Local Setup

```bash
# Create supabase/.env.local with:
SUPABASE_PROJECT_ID=your-project-id
```

Or set temporarily:

```bash
export SUPABASE_PROJECT_ID="your-project-id"
bun run db:dry-run
```

## Common Scenarios

### Adding a New Table

```bash
# 1. Create table in Studio (local)
# 2. Validate
bun run db:validate

# 3. If valid, create migration
supabase db pull -d "add_new_table_name"

# 4. Commit and push
git add supabase/migrations/
git commit -m "Add new_table migration"
git push origin development
```

### Fixing a Security Issue

```bash
# 1. Make changes in Studio
# 2. Test with advisors
bun run db:advisors

# 3. Fix issues advisors report
# 4. Validate and commit
bun run db:validate
git commit -m "Fix: <security issue>"
git push origin development
```

### Emergency Rollback

If production deployment fails:

1. **DO NOT force-push main**
2. Create a new migration that reverts the bad changes
3. Submit as normal PR
4. Merge and deploy

```bash
# Example: revert a column addition
-- migration: YYYYMMDDHHMMSS_revert_bad_column.sql
ALTER TABLE public.users DROP COLUMN bad_column;
```

## Troubleshooting

### `db:validate` fails with migration error

**Problem:** Local migration replay failed

**Solution:**

```bash
# Reset and try again
bun run supabase:stop
bun run supabase:start
bun run supabase:reset

# Check error in test
bun run db:validate
```

### `db:dry-run` says credentials missing

**Problem:** SUPABASE_ACCESS_TOKEN not set

**Solution:**

```bash
# Set temporarily
export SUPABASE_ACCESS_TOKEN="sbp_xxxxxxxxxxxxx"
bun run db:dry-run

# Or add to ~/.bashrc for persistence
echo 'export SUPABASE_ACCESS_TOKEN="..."' >> ~/.bashrc
```

### GitHub Actions deployment fails

**Check:**

1. View Actions logs in GitHub UI
2. Identify the stage that failed (validate, test, deploy)
3. Read the error message
4. **Don't force-push** — create a fix migration instead

## Advanced Options

### Skip Workflow Check

For emergency deployments (not recommended):

```bash
# Manually trigger deployment workflow in GitHub
# Go to Actions → Deploy Schema to Production → Run workflow
```

### Monitor Deployment

Live stream the logs:

```bash
# Get workflow run ID from GitHub
gh run view <run_id> --log

# Or watch in UI:
# https://github.com/<owner>/<repo>/actions/workflows/deploy-schema.yml
```

### Generate Diff Before Merging

Preview what will be deployed:

```bash
# See uncommitted changes
git diff supabase/migrations/

# See changes in current PR
git diff main development -- supabase/migrations/

# Actually show what prod would get (requires credentials)
bun run db:dry-run
```

## Best Practices

✅ **DO:**

- Run `db:validate` before every commit
- Keep migrations small and focused
- Write descriptive migration names: `YYYYMMDDHHMMSS_add_users_rls_policy.sql`
- Add comments in migrations explaining why (not just what)
- Test changes locally in Studio first
- Review migration files before committing

❌ **DON'T:**

- Edit migration files after creation (create new ones instead)
- Use `SELECT *` in migrations (list columns explicitly)
- Forget to add RLS policies to public tables
- Deploy without running `db:dry-run` first
- Force-push broken migrations to main (use revert migrations)

## Learning Resources

- [Supabase Migrations Guide](https://supabase.com/docs/guides/cli/local-development#database-migrations)
- [RLS Policy Examples](https://supabase.com/docs/guides/auth/row-level-security)
- [Security Checklist](https://supabase.com/docs/guides/security/product-security)
- [Schema Diff & Pull](https://supabase.com/docs/guides/cli/managing-schemas)

## Questions?

```bash
# Check Supabase CLI help
supabase --help
supabase db --help

# Verify your setup
bun run supabase:status

# See local migrations
supabase migration list --local
```
