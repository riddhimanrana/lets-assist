# Database Deployment Scripts

Safe, automated schema deployment for Supabase with built-in validation.

## Available Commands

### `bun run audit:inventory`

Generates a local, static inventory of externally reachable and privileged repository surfaces under ignored `.artifacts/audit/surface-inventory/`.

The JSON and Markdown outputs record the exact root/private commits and enumerate route handlers, Server Actions, RPC call sites, SQL functions and `SECURITY DEFINER` definitions, RLS policies, storage buckets, cron/webhook/OAuth/upload/file-processing boundaries, and service-role references. The output contains source identities and paths only; it does not retain credentials, provider payloads, browser state, or application data.

This is discovery evidence, not runtime proof. Effective grants, deployed reachability, and hosted behavior still require the database architecture gate and explicit Development verification.

---

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

Open one reviewed release pull request from `development` to `main`.

The merge does not deploy Production or push the Production schema. After the
exact hosted Development tree passes acceptance, dispatch the protected
[`deploy-schema.yml`](../.github/workflows/deploy-schema.yml) workflow from
`main` with the required Production confirmation and accepted Development SHA.
Follow the [Production cutover
runbook](../docs/development/production-cutover-runbook.md) for the action-time
checks and recovery steps.

The protected workflow rejects unresolved earlier attempts, reruns the release
gates, stages and proves the exact application, enters verified maintenance,
pushes and checks the schema, verifies the final Production alias, and reopens
writes. If a release stops after a write-block attempt, the inline cleanup keeps
writes blocked. The separate failed-release workflow then requires Production
Environment approval before it reconciles the exact Vercel operation and
restores the verified maintenance deployment.

Do not re-run a failed Production workflow. Recovery receipts bind to one run
attempt, and the workflow rejects later attempts before provider access. Wait
for recovery to finish, then start a fresh dispatch.

---

## Production deployment

Do not run `supabase db push` against Production from a workstation. A manual
push skips the exact-tree check, verified maintenance alias, write block,
post-migration target probe, staged application check, and recovery path. Use
the protected [`deploy-schema.yml`](../.github/workflows/deploy-schema.yml)
workflow and the [Production cutover
runbook](../docs/development/production-cutover-runbook.md).

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

## CI/CD pipeline stages

A `main` merge does not run a Production schema push. An authorized operator
must dispatch the protected
[`deploy-schema.yml`](../.github/workflows/deploy-schema.yml) workflow with the
required confirmation and accepted Development SHA.

| Stage             | Purpose                                                                                       | Stop condition                                 |
| ----------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Recovery gate     | Reject re-runs and unresolved earlier Production attempts before provider access              | Any missing or failed attempt recovery receipt |
| Release gates     | Recheck the root tree, private plugin, build, database replay, scale tests, and browser tests | Any accepted-tree or test mismatch             |
| Cutover preflight | Check the Production project, migration baseline, target ledger, and staged artifacts         | Any project, ledger, or preflight mismatch     |
| Maintenance       | Block application writes, promote maintenance, and verify the Production alias                | An unproved write block or alias               |
| Schema            | Push through the workflow, verify migration parity, and probe the target schema               | Any push, parity, or target-schema failure     |
| Application       | Recheck the staged application, promote it, verify the final alias, and reopen writes         | Any health, SHA, alias, or write-reset failure |

Do not replace this workflow with a manual `supabase db push`. Follow the
[Production cutover
runbook](../docs/development/production-cutover-runbook.md) if any stage stops.

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

- Full guide: See `docs/development/supabase-deployment.md`
- Supabase docs: https://supabase.com/docs/guides/cli
- RLS guide: https://supabase.com/docs/guides/auth/row-level-security
