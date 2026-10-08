# Development maintenance cutover

Use the `cutover_phase` entry in the existing **CSF hosted Development acceptance** workflow for a reviewed root change that contracts database permissions. Migrations 700 and 702 require this ordering because the existing application can lose access before its replacement is ready. Ordinary hosted acceptance verifies a deployed result; it does not order the application and database deployment.

The coordinator supports `bootstrap`, `prepare`, `complete` and `recover`. The separately confirmed bootstrap installs only the accepted request guard from the exact 687-migration baseline, producing ledger 688. The other phases never apply migrations or merge a pull request. Supabase's connected persistent Development branch applies the reviewed suffix after the separately approved root merge. Turning off automatic branch creation does not stop that persistent branch's deployment workflow.

## Fixed targets and prerequisites

The controller accepts only repository `riddhimanrana/lets-assist`, Supabase project `ocbuygudvarsuxijxhau`, the root Vercel project `prj_XUDpEktrouxF4dc2VGMegoL00dlE` in team `team_CjhwP5Wl7iAhbDrSFJRFxJjE`, and domain `dev.lets-assist.com`. It leaves Production bindings and controllers unchanged.

Before an operator runs it:

- Configure required reviewers on the GitHub `development` environment. The controller verifies both the configured gate and this run's approved environment review. It follows the configured self-review policy and does not require a second owner account.
- Provide that environment's `DEVELOPMENT_DATABASE_URL`, server key, Vercel credential and automation bypass. The database URL must identify the fixed Development database and a database owner that can set the fixed `authenticator` maintenance flag and observe request transactions. The controller keeps credentials out of arguments, receipts and logs. This owner credential has broader authority than the fixed SQL permits.
- Verify that the Development Vercel credential can access the root project. An existing credential for a plugin project is insufficient. The controller restricts every request to the fixed project and team; that does not prove the provider token itself has project-only permissions. Keep any broader team credential confined to the trusted controller step.
- Supply the existing Development publishable key, `SUPABASE_PROJECT_ID`, canonical `SUPABASE_URL`, root project ID and team ID. No Production environment credential is borrowed.
- Before preparation, finish signed private-release integration, accepted catalog metadata and the release checks. Every migration file must match its committed digest and the entire target must have an accepted catalog. An unapproved future publication migration stops preparation before provider mutation. Bootstrap validates only the accepted 687/688 prefix and never applies or approves later files.
- Stop the five CSF release controls: workbook refresh, import commit, communications, scheduled post publication and publication notifications. Drain active database cron runs and publication leases. Bootstrap pauses the three reviewed database jobs after verifying the exact 687/688 ledger, catalog, worker posture and cron inventory. It refuses other jobs, changed commands or ownership. Preparation verifies that every job remains stopped.
- Hold Auth and Storage administration, external API writers and external schedulers. Include data exports, project cancellation, feedback, recurrence, moderation, cleanup, paper notifications, organization calendars and organization Sheets. The PostgREST request guard does not block these other channels. The required `external-writers-stopped:<candidate SHA>` confirmation records the approving operator's attestation, not independently measured provider state.

The October 7 provider readback confirms that the Development environment now requires review by `riddhimanrana`, permits that owner to review their own run, and allows only `development` and `codex/*` branch deployments. `DEVELOPMENT_DATABASE_URL` is still absent. Credential setup, external-writer shutdown and an approved workflow run remain required before cutover. Local controller tests do not establish those prerequisites or a hosted cutover.

## Install the request guard before preparation

Dispatch the registered workflow from the exact reviewed `codex/` candidate branch with `development_sha` set to its full SHA, `cutover_phase=bootstrap`, the existing root PR number, and `confirmation=cutover-development:bootstrap:<candidate SHA>`. Supply the external writer confirmation and leave `cutover_receipt_run` empty. This is a separate protected operation from preparation.

Bootstrap verifies the current Development base, exact candidate and approved workflow run. It accepts only the exact published ledger 687 or the same prefix with the reviewed guard already installed. It verifies the prefix migration bytes, accepted catalog and quiescent worker state. A separate transaction pauses only the reviewed attendance and retention cron jobs. The controller records that result and verifies fresh quiescence before installing the guard. An unknown shutdown result stops bootstrap before the schema mutation; the jobs may already be paused. A new protected bootstrap dispatch can reconcile that state. The following atomic mutation installs `20260929051600_application_request_write_fence.sql` and its ledger entry. A later unaccepted migration file cannot enter that mutation.

The guard stays inactive. An exact catalog readback, the bounded legacy request transaction barrier, a fresh zero-row GET and a successful zero-row PATCH must all pass before the receipt says `bootstrapped`. No alias or deployment changes occur. A lost response or barrier failure leaves bootstrap unproven. After reviewing the result, a new bootstrap dispatch can reconcile the exact installed 688 prefix and repeat the barrier and probes; it never removes the migration or applies a second copy.

## Prepare before merging

Dispatch the registered workflow from the exact reviewed `codex/` candidate branch. Set `development_sha` to its full SHA, `cutover_phase=prepare`, the existing root PR number, and `confirmation=cutover-development:prepare:<candidate SHA>`. Set the external writer confirmation above. Leave `cutover_receipt_run` empty.

Preparation verifies the open PR's head, repository, Development base and ancestry. It checks that the existing Development alias serves the current Development head. It stages a static maintenance Preview and records its immutable identity. Then it changes only the Development domain's Git binding from `development` to the fixed, nonexistent `codex/development-maintenance-hold` branch. It refuses redirects, another domain bound to either branch, and competing Preview deployments that could assign this domain. It verifies the complete paginated inventory and the binding after the change.

The controller enables the Development PostgREST request guard and sends a fresh zero-row PATCH that must fail with SQLSTATE `25006`. It then waits for the exact active authenticator transactions observed after that runtime proof, without terminating pooled or listener connections. The controller verifies the complete accepted baseline ledger, object catalog and maintenance posture, assigns the recorded maintenance deployment to the fixed domain and verifies its candidate/run marker. The immutable workflow artifact contains a sanitized `prepared` receipt with a four-hour completion window.

Do not merge until that receipt and the actual provider readbacks have been reviewed. The parent release operation owns the merge. Use a normal two-parent merge with the exact recorded Development base and candidate as its parents, and an identical candidate tree. A squash, changed base or extra tree change requires a new review. Prefer an unmarked merge message so the ordinary Vercel build policy does not start an unnecessary automatic build. The verified reserved domain binding provides the alias hold even if a separate Preview is created.

## Complete from the reviewed Development merge

Wait for Supabase's exact Development check to succeed for the merged SHA. Then dispatch the same registered workflow from `development`. Keep `development_sha` set to the original prepared candidate SHA, use `cutover_phase=complete`, the same PR number and `cutover_receipt_run` equal to the preparation run. Confirm `cutover-development:complete:<candidate SHA>`.

The event/controller SHA must equal the current Development head and that PR's merge SHA. Both parents and the full tree must match the preparation receipt. This permits the feature branch to be deleted normally after merge while proving that the controller code is unchanged.

The controller downloads the preparation artifact from its exact GitHub run, verifies its archive digest and single receipt file, and rechecks current provider state. It performs one exact target-ledger/catalog check. It does not wait indefinitely for schema application or accept a partial ledger. Only then does it stage the exact merged application Preview with Development database credentials and disabled worker settings. It verifies Vercel's resolved Git metadata, application status, the database and the held domain before promotion.

After the promoted application's readback passes, a catalog-checked transaction restores only `retain-cron-execution-history`. A mismatch rolls back that restoration. Other cron jobs and provider workers stay stopped. The controller reopens PostgREST writes and verifies a fresh zero-row mutation. It leaves the domain bound to the reserved branch and reports hosted acceptance as pending.

Run the existing hosted acceptance workflow separately from `development` for the actual merged SHA with `cutover_phase=none` and `build_current_revision=false`. Its synthetic functional and performance checks remain required. Worker activation and restoration of automatic Development domain delivery require separate reviewed actions. Completion does not claim those actions occurred.

## Failure and recovery

Receipts record known deployment IDs before later actions. Do not rerun a failed workflow attempt. Dispatch `recover` with the latest mutating run's artifact and the same candidate/PR confirmation. Before merge, dispatch from the exact candidate branch. After merge, dispatch from the exact recorded Development merge. Recovery allows an expired receipt only while Development is still the recorded base or exact recorded merge. A newer Development release refuses all mutations.

Recovery first reasserts the fixed database fence and pauses retention if this cutover restored it. It then checks alias ownership before assigning the recorded maintenance page. It never promotes the old application, reopens writes, restores the domain binding to `development`, or overwrites an unrelated alias. A failed probe or stale alias produces an explicit unproven recovery result for operator reconciliation.

If target verification failed before application creation, recover first, then complete using the successful recovery run's artifact once the exact schema is ready. If an application deployment was recorded, a later complete phase reuses and verifies that same deployment. If an earlier deployment exists without a trusted recorded identity, or creation had an unknown outcome, the controller refuses another creation. Resolve that provider state before proceeding. Completion still refuses an expired preparation window; recovery alone does not renew release approval.

The Vercel alias endpoint has no conditional compare-and-swap operation. The controller checks fresh prior state, writes, and verifies authoritative readback. Workflow concurrency serializes this workflow's runs, but cannot lock out another privileged operator or an independent provider integration. Coordinate that external hold during the release. Unexpected alias ownership stops automatic recovery rather than overwriting the other operator's work.

## Local evidence and provider references

Run the focused controller, artifact and workflow tests with:

```sh
node --test scripts/hosted-development/development-cutover.test.mjs \
  scripts/hosted-development/cutover-bootstrap.test.mjs \
  scripts/hosted-development/cutover-artifact.test.mjs \
  scripts/hosted-development/cutover-workflow.test.mjs
```

The SQL mutation proof uses a separate owned fictional stack. It exercises request transaction settling, fresh PostgREST refusal and reopening, exact retention restoration and rollback on catalog drift. Keep its generated receipts in ignored `.artifacts/`; do not substitute them for hosted readbacks.

The supported provider contracts are [Supabase branching](https://supabase.com/docs/guides/deployment/branching), [Vercel project-domain methods](https://github.com/vercel/sdk/blob/main/docs/sdks/projects/README.md), and [GitHub workflow-run review history](https://docs.github.com/en/rest/actions/workflow-runs#get-the-review-history-for-a-workflow-run).

The permanent hook takes a shared transaction advisory lock before reading the fixed role-catalog flag. Flag changes take the exclusive lock in an explicit read-committed transaction. Activation waits for already guarded requests, including reads. A bounded timeout refuses activation without changing the flag. Writable requests must use read-committed isolation; repeatable-read and serializable writes fail closed even outside maintenance because their snapshots can predate a lock wait. Read-only RPCs can retain those isolation levels. Readiness also refuses incompatible served-role or writable RPC defaults.

Bootstrap does not activate maintenance. Its exact 688 readback always runs the legacy transaction barrier, including an already-applied retry after a lost response. Preparation separately proves the fresh runtime refusal and observes prior transactions again before accepting the maintenance state. A barrier timeout leaves the outcome unproven and never removes the installed migration.
