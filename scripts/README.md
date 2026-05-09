# Database Deployment Scripts

Safe, automated schema deployment for Supabase with built-in validation.

## Available Commands

### `bun run db:validate`

**Comprehensive local validation before pushing to production.**

```bash
bun run db:validate
```

**What it does:**
- ✓ Validates migration file naming (YYYYMMDDHHMMSS_description.sql)
- ✓ Checks for duplicate timestamps
- ✓ Ensures all migrations have description comments
- ✓ Tests migration replay with local reset
- ✓ Provides clear feedback on any issues

**When to use:**
- Before committing migration files
- After pulling schema changes from Studio
- To verify migration replay works locally

**Example output:**
```
✓ All migration filenames are valid
✓ No duplicate timestamps
✓ All migrations have descriptions
✓ Migration replay successful

All validations passed!
```

---

### `bun run db:dry-run`

**Safely preview what would be deployed to production WITHOUT making changes.**

```bash
export SUPABASE_ACCESS_TOKEN="sbp_xxxxxxxxxxxxx"
bun run db:dry-run
```

**What it does:**
- ✓ Connects to linked production database
- ✓ Shows pending migrations
- ✓ Runs actual dry-run against production
- ✓ Reports success/failure without applying changes

**When to use:**
- Before manually deploying to production
- To see what changes will be applied
- To verify production compatibility

**Requirements:**
- `SUPABASE_ACCESS_TOKEN` environment variable set
- `SUPABASE_PROJECT_ID` in environment or supabase/.env.local

**Get credentials:**
1. Go to [Supabase Account Tokens](https://app.supabase.com/account/tokens)
2. Create new token
3. Copy and store securely

---

### `bun run db:advisors`

**Run security and performance advisors on your schema.**

```bash
bun run db:advisors
```

**What it does:**
- ✓ Checks for security vulnerabilities (missing RLS, exposed functions, etc.)
- ✓ Identifies performance issues (missing indexes, etc.)
- ✓ Provides guidance on fixes

**When to use:**
- Before finalizing schema changes
- When adding sensitive tables or functions
- As part of code review

**Output:**
```
Running Security Advisors...
✓ No security issues detected

Running Performance Advisors...
✓ No performance issues detected

All advisors checks passed!
```

**Requirements:**
- Local Supabase running
- Supabase CLI 2.81.3+ (for full advisors support)

---

## Workflow for Development

### 1. Make Schema Changes

```bash
# Start local Supabase
bun run supabase:start

# Open Studio and make changes
open http://localhost:54323
```

### 2. Generate Migration

```bash
# Pull changes into migration file
supabase db pull -d "description_of_changes"
```

### 3. Validate Locally

```bash
# Comprehensive validation
bun run db:validate

# (Optional) Check security/performance
bun run db:advisors
```

### 4. Commit & Push

```bash
# If validation passed
git add supabase/migrations/
git commit -m "Add: description of schema change"
git push origin development
```

### 5. Create PR

Open PR on GitHub: `development` → `main`

GitHub Actions will automatically:
- Run all validations again
- Test migration replay
- Check security/performance
- Deploy to production if all checks pass

---

## Manual Production Deploy

**⚠️ Only after validation passes**

```bash
# 1. Dry-run check
export SUPABASE_ACCESS_TOKEN="sbp_xxxxxxxxxxxxx"
bun run db:dry-run

# 2. If dry-run passed, deploy
supabase link --project-ref your-project-id
supabase db push --linked --yes
```

---

## Troubleshooting

### "Migration format invalid"
Check filename format: `YYYYMMDDHHMMSS_description.sql`
- ✓ 20260412220000_fix_all_advisor_findings.sql
- ✗ 2026_04_12_fix.sql
- ✗ migration.sql

### "Migration replay failed"
Ensure your local Supabase is clean:
```bash
bun run supabase:stop
bun run supabase:start
bun run db:validate
```

### "Dry-run failed with credentials error"
Set your access token:
```bash
export SUPABASE_ACCESS_TOKEN="sbp_xxxxxxxxxxxxx"
bun run db:dry-run
```

### "Advisors says things missing"
Common issues:
- ✗ Missing RLS policies on public tables → Add policies
- ✗ Exposed security definer functions → Move to private schema
- ✗ Missing indexes → Add indexes to frequently queried columns

---

## CI/CD Pipeline Stages

GitHub Actions runs 4 stages when you merge to `main`:

| Stage | Purpose | Takes | Fails If... |
|-------|---------|-------|-----------|
| **Validate** | Check file formats, naming | 1-2s | Bad filename format |
| **Test Locally** | Replay migrations locally | 30-60s | Migration fails to replay |
| **Advisors** | Security & perf checks | 15-30s | Critical security issues found |
| **Deploy** | Push to production | 30-120s | Dry-run fails |

If ANY stage fails, deployment is blocked and manual approval is required.

---

## Best Practices

✅ **Always:**
- Run `db:validate` before committing
- Use descriptive migration names
- Add comment explaining the why, not just what
- Test in local Studio first
- Run `db:advisors` for sensitive changes

❌ **Never:**
- Skip validation
- Edit migration files after creation
- Deploy without dry-run
- Force-push broken migrations to main
- Ignore advisor security warnings

---

## More Info

- Full guide: See `docs/SUPABASE_DEPLOYMENT.md`
- Supabase docs: https://supabase.com/docs/guides/cli
- RLS guide: https://supabase.com/docs/guides/auth/row-level-security
