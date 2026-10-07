# Production request-fence bootstrap

This is a separate, manual Production change. Preparing this code does not authorize its execution, a main merge, or a release. The existing Development coordinator cannot operate on Production.

The revised maintenance workflow refuses an existing 687-migration database without the reviewed request hook. This bootstrap installs only `20260929051600_application_request_write_fence.sql`, immediately after the published `20260929051500` baseline. It adds the exact migration ledger row in the same transaction. It does not enable the maintenance flag, change application aliases, deploy an app, apply the remaining migrations, or change worker and cron enablement.

## Prerequisites and approval scope

The bootstrap source and accepted 687/688 catalog metadata must first be reviewed and merged to main through the separately approved release process. The manual workflow must exist on the repository default branch before GitHub can dispatch it. Do not dispatch a feature revision, create a tag to bypass that condition, or use Development's credentials.

Before requesting execution approval, retain local proof that the shared SQL accepts the exact baseline, rejects altered catalogs/settings/ledgers, installs the guard atomically and can reconcile an uncertain response. Fresh local PostgREST reads and zero-row writes must still work with blocking disabled; separately prove that enabling the installed guard blocks writable requests and reopening restores them. The bootstrap's hosted success receipt proves installation with blocking disabled. It does not prove a later maintenance window.

The permanent hook admits writable requests only at READ COMMITTED isolation, including when maintenance is disabled. REPEATABLE READ and SERIALIZABLE can retain an older snapshot after waiting for the request gate, so the hook refuses those writable transactions. Read-only requests remain supported. The shared catalog checks reject incompatible role or writable RPC isolation defaults before bootstrap. Include this compatibility constraint in the approval package and retain its actual HTTP regression evidence.

Use the protected `production` GitHub environment with configured required reviewers. Provision its reviewed owner connection as `PRODUCTION_BOOTSTRAP_DATABASE_URL`, restricted to the fixed Production project `fotdmeakexgrkronxlof`, PostgreSQL database `postgres`, and the exact owner username. Only `sslmode=require`, `verify-ca` or `verify-full` is permitted; no connection routing or authentication override query parameters are accepted. The controller passes credentials in a restricted subprocess environment, never command arguments. Its separate Production server key must succeed against the fixed API before mutation. The workflow exposes these credentials only to the bootstrap step.

Stop and verify database cron jobs, the five CSF worker controls and active publication-notification leases before running. Record external writer quiescence for Auth, Storage, direct database users, Vercel/GitHub schedules and other providers. The operator's source-bound attestation records this requirement; it does not remotely enforce those systems. This workflow stops or resumes no job. The Data API remains open during this additive bootstrap.

The approval package must name the exact current main SHA, fixed project, the one migration hash, baseline and resulting catalog identities, evidence paths, reviewer and external-writer plan. It must explicitly exclude the subsequent maintenance cutover and any other Production operation.

## Execute the reviewed workflow

Select `Bootstrap Production request fence` on current `main`. Supply its exact SHA in `accepted_main_sha`, `bootstrap-production:fotdmeakexgrkronxlof:<exact main SHA>` as the Production confirmation, and `external-writers-stopped:<exact main SHA>` for the quiescence attestation. Do not approve a stale pending run. The controller accepts only attempt one of a current, at-most-four-hour-old manual run.

The controller reads GitHub's actual environment approval history. It requires one approved review for the exact Production environment, a permitted current actor, the exact workflow/run/source identity and unchanged current main. A caller-provided reviewer string grants no authority. It rechecks this evidence immediately before mutation and after verification. The workflow shares `production-schema-deployment` concurrency with the schema release and does not cancel an active run.

Only exact 687 or exact 688 is accepted. The shared plan verifies every filename and migration hash in that fixed prefix and both approved catalogs. Later source files are neither accepted nor included in the mutation. A database that already has a later ledger tail is refused. The transaction rechecks the baseline under the ledger lock before applying the reviewed SQL. The actual request flag must remain off. Unknown database settings or a different hook require separate review.

After installation, the controller independently reads the ledger/catalog and waits up to 20 seconds for the exact preexisting authenticator transaction identities to settle. It never terminates pooled connections or the schema listener. It then makes fresh zero-row GET and PATCH requests against the fixed Production API. The PATCH uses contradictory predicates so it cannot change a row. It repeats catalog/quiescence/open-flag verification and current GitHub authority before reporting success. The flag's `pgrst.app_settings.maintenance_write_block` name is stored in the authenticator role catalog and read there by the hook. This procedure does not assume PostgREST exports it as a runtime setting.

## Failure and reconciliation

The sanitized artifact is `production-request-fence-bootstrap-<run id>` and contains only its source, run, reviewer, target, ledger digests and phase. Raw database/provider output, URLs, keys and response rows are suppressed.

A missing or lost mutation response triggers readback, never a second write in that run. Exact 688 with the reviewed catalog, open flag and all remaining proofs may complete as `verified-after-unknown-response`. Catalog readback cannot prove a post-commit transaction barrier completed, so every reconciliation path repeats the bounded read-only barrier. A timeout leaves the run unproven even when the migration committed. An unchanged 687, partial/drifted catalog, failed API probe, changed main or ambiguous approval also leaves the run unproven. A later approved fresh run may reconcile exact 688 without reapplying the migration, or apply it to verified 687. A future ledger tail is refused.

Do not delete or repair a migration record, remove the hook, reset role settings, reopen jobs or retry the mutation manually to make a failed run green. Reconcile the recorded phase and actual fixed target first. The additive guard stays installed if its transaction committed. Operational holds stay under their own reviewed recovery plan. A failure after commit is not permission to roll back protected history or deploy an older application.

Successful bootstrap allows the separate [Production cutover runbook](production-cutover-runbook.md) to verify and enable the installed guard later. That cutover still requires its own explicit approval, recovery capture, exact app/schema checks and fresh HTTP write-refusal evidence. Source controls cannot serialize an unrelated external operator; refresh authority and provider state at that boundary.
