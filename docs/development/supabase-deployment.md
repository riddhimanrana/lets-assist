# Supabase schema deployment

Let's Assist keeps database migrations in an append-only ledger and releases
Production schema and application changes together. A merge alone never changes
the Production database.

## Local workflow

Start the local stack that matches your task. For CSF work, use the isolated
stack documented in [local environments](environments.md).

```bash
bun run supabase:start
```

Create a forward migration with a unique timestamp. Do not edit a migration
that may have run in any shared environment.

```bash
supabase migration new <short_description>
```

Write the SQL in the generated file. Every new or replaced function must state
its `REVOKE` and `GRANT` rules. Add client-callable public functions to the
architecture allowlist in the same change.

Do not run `supabase db pull` in this repository. The redesign audit records
remote drift that a pull could import into the migration ledger.

Run the applicable local gates before opening a pull request.

```bash
bun run db:validate
bun run db:test:redesign
bun run typecheck
bun run lint
```

Use the task-specific database and browser gates listed in
[testing](testing.md). A filename check or risky-pattern grep does not parse SQL
and does not replace a full replay.

## Development release

Base the pull request on `development`. The private plugin must merge to its own
`development` branch before the root repository advances the gitlink.

The accepted root tree must pass local gates, CI, one hosted Development
deployment, and exact-SHA hosted acceptance. Local results and a successful Git
push do not prove the hosted environment.

Vercel Git builds are cost-gated. Ordinary commits and pull requests do not
request a hosted build. The reviewed Development integration commit carries the
release marker once, which produces one candidate deployment.

## Production release

Production uses the manually dispatched
`.github/workflows/deploy-schema.yml` workflow from `main`. The workflow requires
the typed Production confirmation and the exact hosted Development SHA. It also
requires the `production` GitHub Environment review.

The workflow performs these operations in order:

1. Reject re-runs and unresolved earlier Production attempts.
2. Run the reusable root, plugin, build, database, scale, and browser gates.
3. Prove that `main` has the same tree as the accepted Development SHA.
4. Build the exact application once with Production environment values.
5. Link and verify the reviewed Supabase project, then show the pending
   migration set.
6. Stage both the repository-owned static maintenance artifact and the exact
   application without moving domains. Prove both artifacts and retain the
   recovery manifest.
7. Set `authenticator.default_transaction_read_only=on`, terminate existing
   authenticator sessions, and prove that a fresh PostgREST mutation returns
   SQLSTATE `25006`.
8. Promote and verify the maintenance deployment at the Production alias.
9. Apply the pending migrations and verify exact migration-ledger parity.
10. Check the same staged application's deep status endpoint against
    Production.
11. Promote the staged application and verify that the Production alias points
    to its exact deployment ID.
12. Reset the authenticator write block and terminate its old sessions. This is
    the last release mutation.

The write block covers application traffic through PostgREST. It does not block
Supabase Auth, Storage, direct database sessions, or internal provider writers.
The operator must still stop scheduled workers and confirm database quiescence
as described in the [Production cutover runbook](production-cutover-runbook.md).

If a step fails after the write block is enabled, the failure path reasserts the
block. Do not open writes or retry a partial migration push until the migration
ledger, active alias, and failed step are known.

## Required repository configuration

The Production GitHub Environment supplies the reviewed Supabase, Vercel, and
protection-bypass values used by the workflow. At minimum, the workflow expects:

- `SUPABASE_PROJECT_ID`
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_SECRET_KEY`
- `PRODUCTION_READONLY_URL`
- `VERCEL_TOKEN`
- `VERCEL_AUTOMATION_BYPASS_SECRET`
- `VERCEL_TEAM_ID` as an environment variable
- `VERCEL_ROOT_PROJECT_ID` as an environment variable

Do not copy these values into a shell history, issue, pull request, workflow
summary, or repository file.

## Failure handling

Migrations are forward-only. Never force-push `main`, delete a migration, or
edit a migration that may have run remotely.

- If the push fails partway, inspect the remote ledger and failed migration.
  Fix forward and repeat the dry run before resuming.
- If the schema succeeds but the application fails, keep the maintenance alias
  and PostgREST write block active. Prefer a compatible forward application fix.
- If data changes are wrong, use the verified logical restore described in the
  cutover runbook while application writes remain stopped.
- If an index is invalid, follow the migration-specific recovery plan instead
  of rerunning the whole tail blindly.

## Operator commands

Use read-only commands for diagnosis:

```bash
supabase migration list --linked --output-format json
supabase db push --linked --dry-run
gh run view <run_id> --log
```

Do not run `supabase db push --linked --yes` by hand for a normal or emergency
Production release. The workflow couples the schema push to the exact
application bytes, maintenance alias, write guard, health check, and final alias
proof.

## Related documents

- [Production cutover runbook](production-cutover-runbook.md)
- [Deployment boundaries](deployment.md)
- [Supabase redesign audit](../architecture/supabase-redesign-audit.md)
- [Testing](testing.md)
