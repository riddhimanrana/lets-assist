# Production request-fence bootstrap

This is a separate, manual Production change. Preparing this code does not authorize its execution, a main merge, or a release. The existing Development coordinator cannot operate on Production.

## Protected CLI diagnosis

The existing workflow defaults to `mode: diagnose`. After this revision is reviewed
and integrated, a separately approved diagnostic dispatch uses current `main` in
`accepted_main_sha` and
`diagnose-production:fotdmeakexgrkronxlof:<exact main SHA>` in
`production_confirmation`. It retains the same Production environment reviewers,
actual approval-history checks, exact checkout, first-attempt restriction, and
schema-deployment concurrency lock. No writer-stop attestation is required or
inferred for diagnosis; active cron jobs can remain active.

Only the existing `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` are exposed
to the diagnostic step, alongside GitHub authority and the fixed project ID.
It does not use a database URL or server key, read credential files, extract a
connection from CLI caches, request new secrets, or alter review policy. Standard
`supabase link` owns its normal local cache; its JSON result must name the fixed
project. Every linked command also names that project explicitly. The CLI subprocess excludes inherited routing overrides,
PG options, tracing configuration and other release credentials.

The diagnostic requires CLI `2.120.0`, discovers required flags through `--help`,
validates every one of the 740 repository migration files against the existing
digest catalog, and links only `fotdmeakexgrkronxlof`. It submits one fixed SELECT
through `db query --linked --agent no --output json`. Required flags are
discovered through `--help`; the plain JSON row array is parsed strictly. Empty or malformed output fails closed. The resulting ordered ledger must
equal the exact points-first 688 baseline through `20261013071100`.

It then runs exactly:

```sh
supabase db push --linked --project-ref fotdmeakexgrkronxlof --dry-run --include-all --skip-vault --output-format json
```

`--include-all` permits planning pending versions that precede the already applied
hotfix. `--skip-vault` avoids resolving configured Vault secrets. The structured
result must report `dryRun: true`, `upToDate: false`, empty roles/seeds, and exactly
the expected fields and success message. Every reported filename must match the reviewed 52-step rollout catalog
in order, ending at `20261020031605_project_calendar_deletion_fence.sql`. A second
fixed ledger SELECT and fresh authority/checkout checks must succeed before the
receipt reports `diagnosed`. Only reviewed filenames, hashes, phase, command exit
status and output byte counts are retained; raw CLI output remains suppressed.
No apply command, repair, API write probe, job pause, app staging or deployment is
part of this mode. A dry-run proves planning and connectivity, not migration
execution, catalog parity, quiescence or application compatibility.

The CLI query path is deliberately separate from the bootstrap SQL. The established
bootstrap includes psql `\gset`, `\if`, `\else` and `\endif` directives as well
as explicit transactions, locks and atomic ledger insertion. `db query --linked`
forwards SQL to the Management API; it is not a psql interpreter and cannot execute
that script unchanged. It also does not establish the explicit read-only session
used by the psql preflight. The diagnostic SELECT has no user-supplied SQL or
mutating expressions. The reported single-prepared-statement restriction must be
checked against the actual pinned binary before proposing any mutation transport
replacement; do not split the established transaction across CLI invocations.

The [pinned query handler](https://github.com/supabase/cli/blob/v2.120.0/apps/cli/src/commands/db/query/query.handler.ts)
confirms plain JSON output with `--agent no --output json` and forwarding SQL to
the Management API. The [push core](https://github.com/supabase/cli/blob/v2.120.0/apps/cli/src/command-internal/db-push-core.ts)
keeps Vault, migration and ledger writes in the non-dry-run branch; its structured
result contract is implemented by the [JSON output layer](https://github.com/supabase/cli/blob/v2.120.0/apps/cli/src/shared/output/output.layer.ts).
The [database resolver](https://github.com/supabase/cli/blob/v2.120.0/apps/cli/src/command-internal/db-config.layer.ts)
uses the supplied nonempty password on both direct and pooler paths instead of
minting a temporary login role. The diagnostic refuses a missing or blank password.

Local controller tests use synthetic CLI responses. The cloud preparation
environment has no pinned CLI or Bun. The public versioned archive download used
by the [pinned setup action](https://github.com/supabase/setup-cli/blob/3c2f5e2ae34c34e428e8e206e2c4d21fa2d20fbf/src/main.ts)
(`supabase_2.120.0_linux_amd64.tar.gz`) returned HTTP 403 there. Actual
`2.120.0 --help`, native transport, and PostgreSQL execution therefore await the
separately approved protected diagnostic in Actions. Source inspection and local
tests are not hosted diagnostic evidence or authorization to apply migrations. Installation
remains the existing psql path under explicit `mode: install` and its original
source-bound confirmations. The subsequent release still requires compatible app
and maintenance staging, writer containment and the reviewed recovery boundary
before any migration application.

The revised maintenance workflow refuses an existing 687-migration database without the reviewed request hook. This bootstrap installs only `20260929051600_application_request_write_fence.sql`, immediately after the published `20260929051500` baseline. It adds the exact migration ledger row in the same transaction. It does not enable the maintenance flag, change application aliases, deploy an app, apply the remaining migrations, or change worker and cron enablement.

## Prerequisites and approval scope

The bootstrap source and applicable accepted catalog metadata must first be reviewed and merged to main through the separately approved release process. The manual workflow must exist on the repository default branch before GitHub can dispatch it. Do not dispatch a feature revision, create a tag to bypass that condition, or use Development's credentials.

Before requesting execution approval, retain local proof that the shared SQL accepts the exact baseline, rejects altered catalogs/settings/ledgers, installs the guard atomically and can reconcile an uncertain response. Fresh local PostgREST reads and zero-row writes must still work with blocking disabled; separately prove that enabling the installed guard blocks writable requests and reopening restores them. The bootstrap's hosted success receipt proves installation with blocking disabled. It does not prove a later maintenance window.

The permanent hook admits writable requests only at READ COMMITTED isolation, including when maintenance is disabled. REPEATABLE READ and SERIALIZABLE can retain an older snapshot after waiting for the request gate, so the hook refuses those writable transactions. Read-only requests remain supported. The shared catalog checks reject incompatible role or writable RPC isolation defaults before bootstrap. Include this compatibility constraint in the approval package and retain its actual HTTP regression evidence.

Use the protected `production` GitHub environment with configured required reviewers. Provision its reviewed owner connection as `PRODUCTION_BOOTSTRAP_DATABASE_URL`, restricted to the fixed Production project `fotdmeakexgrkronxlof`, PostgreSQL database `postgres`, and the exact owner username. Only `sslmode=require`, `verify-ca` or `verify-full` is permitted; no connection routing or authentication override query parameters are accepted. The controller passes credentials in a restricted subprocess environment, never command arguments. Its separate Production server key must succeed against the fixed API before mutation. The workflow exposes these credentials only to the bootstrap step.

Stop and verify database cron jobs, the five CSF worker controls and active publication-notification leases before running. Record external writer quiescence for Auth, Storage, direct database users, Vercel/GitHub schedules and other providers. The operator's source-bound attestation records this requirement; it does not remotely enforce those systems. This workflow stops or resumes no job. The Data API remains open during this additive bootstrap.

The approval package must name the exact current main SHA, fixed project, the one migration hash, baseline and resulting catalog identities, evidence paths, reviewer and external-writer plan. It must explicitly exclude the subsequent maintenance cutover and any other Production operation.

## Execute the reviewed workflow

Select `Bootstrap Production request fence` on current `main` with `mode: install`. Supply its exact SHA in `accepted_main_sha`, `bootstrap-production:fotdmeakexgrkronxlof:<exact main SHA>` as the Production confirmation, and `external-writers-stopped:<exact main SHA>` for the quiescence attestation. Do not approve a stale pending run. The controller accepts only attempt one of a current, at-most-four-hour-old manual run.

The controller reads GitHub's actual environment approval history. It requires one approved review for the exact Production environment, a permitted current actor, the exact workflow/run/source identity and unchanged current main. A caller-provided reviewer string grants no authority. It rechecks this evidence immediately before mutation and after verification. The workflow shares `production-schema-deployment` concurrency with the schema release and does not cancel an active run.

The legacy path accepts only the exact 687 baseline or its fence-first 688
result. The current points-first path accepts only the first 687 migrations plus
`20261013071100`, or that exact 688 baseline plus the request fence at count 689.
The points-first path requires the exact reviewed 739 source and hotfix bytes.
Its highest ledger version remains the hotfix; the mutation and receipt still
name the request-fence version `20260929051600` explicitly. Both paths verify
all applicable migration bytes and before/after catalogs. No later migration is
included in the mutation, and all other ledger tails are refused. The transaction rechecks the baseline under the ledger lock before applying the reviewed SQL. The actual request flag must remain off. Unknown database settings or a different hook require separate review.

After installation, the controller independently reads the ledger/catalog and waits up to 20 seconds for the exact preexisting authenticator transaction identities to settle. It never terminates pooled connections or the schema listener. It then makes fresh zero-row GET and PATCH requests against the fixed Production API. The PATCH uses contradictory predicates so it cannot change a row. It repeats catalog/quiescence/open-flag verification and current GitHub authority before reporting success. The flag's `pgrst.app_settings.maintenance_write_block` name is stored in the authenticator role catalog and read there by the hook. This procedure does not assume PostgREST exports it as a runtime setting.

## Failure and reconciliation

The sanitized artifact is `production-request-fence-bootstrap-<run id>` and contains only its source, run, reviewer, target, ledger digests and phase. Raw database/provider output, URLs, keys and response rows are suppressed.

A missing or lost mutation response triggers readback, never a second write in that run. Exact 688 with the reviewed catalog, open flag and all remaining proofs may complete as `verified-after-unknown-response`. Catalog readback cannot prove a post-commit transaction barrier completed, so every reconciliation path repeats the bounded read-only barrier. A timeout leaves the run unproven even when the migration committed. An unchanged applicable baseline, partial/drifted catalog, failed API probe, changed main or ambiguous approval also leaves the run unproven. A later approved fresh run may reconcile the exact applicable after-state without reapplying the migration, or apply it to the verified before-state. A future ledger tail is refused.

Do not delete or repair a migration record, remove the hook, reset role settings, reopen jobs or retry the mutation manually to make a failed run green. Reconcile the recorded phase and actual fixed target first. The additive guard stays installed if its transaction committed. Operational holds stay under their own reviewed recovery plan. A failure after commit is not permission to roll back protected history or deploy an older application.

Successful bootstrap allows the separate [Production cutover runbook](production-cutover-runbook.md) to verify and enable the installed guard later. That cutover still requires its own explicit approval, recovery capture, exact app/schema checks and fresh HTTP write-refusal evidence. Source controls cannot serialize an unrelated external operator; refresh authority and provider state at that boundary.
