# Deployment boundaries

Feature branches target `development`. Each pull request must pass hosted CI.
Only the merged integration candidate receives the hosted Development deployment
and acceptance run described below. `development` is not Production, and a
ready deployment is not proof that the intended alias, environment variables,
database history, or authenticated journeys are correct.

Promotion from `development` to `main` is a separate release operation. It requires explicit authorization and Production-specific migration, provider, and browser checks. Repository cleanup does not authorize Production database mutation, alias reassignment, or release claims.

Supabase changes follow [the deployment workflow](supabase-deployment.md). Private-plugin changes follow [the two-repository workflow](private-plugins.md).

Permission contractions require the [Development maintenance cutover](development-cutover.md) before the root merge. Its prepare phase proves the maintenance hold; its complete phase accepts only the exact reviewed merge and target catalog. Ordinary hosted acceptance runs afterward and does not provide that ordering.

## Explicit Development builds

A normal Development merge builds only when the first commit-message line carries
`[deploy-development]` or matches the signed CSF integration convention. A manual
Vercel redeploy retains that message, so it can be canceled by the same rule.

For an approved manual Preview build of the current Development revision, set
`LETS_ASSIST_EXPLICIT_DEVELOPMENT_SHA` on that deployment to its full Git SHA.
The build policy accepts it only for `VERCEL_ENV=preview`, branch `development`,
and an exact SHA match. It does not change shared project settings or authorize
Production. The hosted Development acceptance workflow exposes
`build_current_revision` for this recovery path. Its build job uses the protected
Production environment's root-project credential because Development's credential
belongs to the plugin project. The deployment target remains Preview, and the
job requires the environment review before using that credential. It checks the current branch and
project binding, creates one Preview, retains its identity, and waits for that
same deployment before running the usual acceptance gates. A failed or unknown
create outcome must be reconciled before another request. Verify the Preview's Git metadata and Development alias before
starting hosted acceptance. Do not create an empty marker commit to trigger a build.

## App-only Production release

Use `Deploy accepted Production app` when Production already has the exact
schema required by a hosted-accepted application. This path does not require an
external drive, logical export, restore, or a `PRODUCTION_READONLY_URL` secret.
It does not run migrations, change database write controls, approve imports, or
enable CSF workers. The database-cutover workflow remains separate.

The dispatch takes full `release_sha` and `hosted_development_sha` values and
`deploy-app-only:<release SHA>` confirmation. The controller runs from reviewed
`main`; the application checkout uses the explicit release SHA. That SHA must
be reachable from `main`, contain the accepted SHA, and have the identical Git
tree. A workflow-only update does not require another application build in
Development when these application bytes have already passed acceptance.

For the isolated dependency security repair, `Deploy accepted Production app`
also supports a security-only source gate. Set `production_app_sha` to the full
SHA currently served on `lets-assist.com`, leave `hosted_development_sha` and
all waiver fields empty, and enter
`security-only:<Production app SHA>:<release SHA>` as
`security_only_confirmation`. Keep the ordinary
`deploy-app-only:<release SHA>` confirmation. The release SHA must be the
reviewed `main` workflow commit. This path is restricted to the reviewed
dependency, vendored glob replacement, and release-tooling files; application
source, database migrations, private gitlink, and environment settings cannot
change through it. The controller also checks the exact reviewed bytes of the
dependency repair and release workflow. The workflow independently checks the
verifier's exact Git blob before executing it. A later change to an allowed
filename requires its own review; the filename alone does not extend this
exception.

The controller proves the current Production alias points to the exact ready
Git-connected application commit, verifies the Vercel project and GitHub
binding, and requires a successful full CI run on the release SHA. The baseline
must carry a `gitSource` repository ID and commit SHA; a CLI deployment with
only GitHub-looking metadata fails this gate. Full CI
includes the dependency audit, isolated database/browser checks, and the
Production-schema catalog tests. The existing app-only workflow then checks
the live schema, stages the exact security build, verifies its SHA and deep
status/login/protected-route behavior, and promotes only after the old alias
still matches the reviewed baseline. It verifies the public alias and rolls
back to the prior deployment if promotion fails to settle. This alternative
does not claim the authenticated hosted Development journeys or CSF load test
passed; those remain a distinct evidence boundary. No Development history is
reset, and no waiver or local-validation override is accepted in this mode.
The new release SHA starts with CSF workers off. Before a later forward
migration, disable any still-enabled controls on the prior SHA as well as the
new SHA and verify publication leases are drained; the migration transaction
checks every release-control row, not just the publicly served SHA.

Automatic marked Development releases use functional hosted acceptance. The
existing `[deploy-development]` merge subject selects one exact-SHA Preview and
one acceptance run; no second marker or performance waiver is required. A manual
acceptance dispatch can still select `mode: full` for optional 100-session load
and performance testing. Full runs keep their separate status context and do not
stand in for the required functional receipt.

Production requires the trusted successful `csf-hosted-development-functional`
status for the exact accepted SHA. Functional acceptance verifies the deployed
application and alias, fictional member and officer sessions, attendance/browser
workflows, persisted staff-view changes, review navigation and browser errors.
It does not run or attest the 100-session load or performance thresholds. The
accepted commit must remain Development-reachable, and the release must have the
identical tree. Trusted quality and database replay CI, schema/catalog checks,
private release verification, organization access, worker leases, protected
reviews and recovery remain required. Ordinary CI and hosted functional acceptance
are separate checks; this policy does not guarantee a fixed release duration.

The existing performance-waiver inputs remain compatible for older callers, but
are no longer needed for normal releases. If supplied, their source-bound reason,
actor and run ID are still recorded as `waived, not passed`; they create no
successful status and cannot replace functional acceptance.

### Broader local validation override

Both app-only deployment and reviewed forward migrations also expose
`local_validation_confirmation`, `local_validation_reason` and
`local_validation_evidence`. This is a broader
exception than the performance waiver. Its confirmation is
`deploy-with-local-validation:<release SHA>:<Development SHA>`. The controller
requires a 20–1000 character reason and a GitHub actor with repository write,
maintain, or admin permission. The protected Production environment and separate
Production operation confirmation still apply.

| Mode                      | Hosted acceptance                                          | Remote quality and database replay |
| ------------------------- | ---------------------------------------------------------- | ---------------------------------- |
| Normal                    | Exact trusted successful run                               | Exact trusted successful full run  |
| Performance waiver        | Trusted functional acceptance required; performance waived | Required                           |
| Local validation override | Waived, not passed                                         | Both waived, not passed            |

The local override is an operator attestation. The controller requires a current
exact-candidate evidence receipt and checks the supplied sanitized report bytes.
It does not execute or independently prove the local tests. Do not describe this exception as successful
hosted acceptance. The two waiver modes are mutually exclusive. Neither bypasses
exact source trees and ancestry, Production environment review, schema/catalog
checks, private release verification, deployment identity, rollback safeguards,
or separate worker activation. A forward-migration override still authorizes
only that workflow's reviewed migration suffix, not arbitrary database changes.

For a proposed local override, prepare a sanitized local evidence receipt using
[scripts/production/local-validation-evidence.mjs](../../scripts/production/local-validation-evidence.mjs).
It checks the exact release and accepted SHAs, Git tree, private gitlink,
operator, a repository issue or PR change record, expiry within 24 hours, and
report digests for lint, typecheck, unit, build, database, and browser checks.
Each check must name a zero exit status and finish within the preceding 24-hour
window. Run it from a clean candidate checkout with ignored reports:

```bash
node scripts/production/local-validation-evidence.mjs \
  --file .artifacts/local-validation/receipt.json \
  --reports .artifacts/local-validation \
  --release-sha <full-release-sha> \
  --accepted-sha <full-development-sha> \
  --actor <github-login>
```

The receipt schema is the strict object used in the companion test fixtures.
Each report is `<check-name>.log`; retain only sanitized output. Keep receipts
and reports outside committed source. Include the receipt SHA-256, change-record
URL, expiry, and exact waived gates in the release reason and current release
status. Supply `local_validation_evidence` as a strict JSON envelope with
`receipt` and `reports` fields. `reports` maps each of the six check names to its
sanitized UTF-8 report text. The envelope is limited to 48 KiB and each report to
1–4096 bytes. The controller rejects missing, invalid, changed or expired
reports before it skips any hosted or remote CI check. It compares the evidence
tree and private gitlink with the actual release checkout, not receipt claims.
Normal validation and the narrower performance waiver do not need this input.

After the checker passes, prepare the envelope without publishing it:

```bash
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from "node:fs";
const dir = ".artifacts/local-validation/";
const receipt = JSON.parse(readFileSync(dir + "receipt.json", "utf8"));
const names = ["lint", "typecheck", "unit", "build", "database", "browser"];
const reports = Object.fromEntries(names.map(name => [name,
  readFileSync(dir + name + ".log", "utf8")]));
writeFileSync(dir + "envelope.json", JSON.stringify({ receipt, reports }));
JS
```

Paste that envelope into `local_validation_evidence` only after reviewing every
report for secrets and real user data. Workflow dispatch inputs and step
environment values can be visible in this public repository. The controller
prints only fixed failures or verified identities and digests; it never prints
the report text. The retained source-verification artifact includes receipt and
envelope hashes, expiry, change record and the explicit operator-attestation
limit. Report-byte checks do not prove who executed tests or turn those reports
into a trusted CI run.

The workflows recheck source, actor permission and evidence freshness before a
Production build, migration application and alias promotion when the local
override is selected. An expired approval stops forward progress. Existing
rollback steps remain available to recover a release that already changed the
alias; the evidence input does not authorize a separate release or worker run.

Before approving the exception, the release owner must inspect the reports,
confirm the exact candidate and explicit Production authorization, and record
why the ordinary hosted gates cannot be used. Let the exception expire after
this operation. A different candidate, expired evidence, failed check, or changed
report requires a new review. Keep `source-verification-<run ID>` linked to the
change record even if later release work fails. Reconcile a failed or cancelled
release before another dispatch; the override is not a retry or recovery bypass.

Before building, the controller verifies the applicable acceptance mode and its
required checks, exact private gitlink, and Vercel project. The
existing Supabase management token uses the read-only query endpoint for ordinary checks.
The final catalog uses the authorized query connection inside an explicit
PostgreSQL `BEGIN READ ONLY` transaction with `search_path` fixed to
`public, extensions`. Catalog deparsing otherwise changes across connection
roles. The fixed catalog query cannot write in this transaction.
Checks compare every migration version and verify the CSF tables, functions,
grants, indexes, constraints, triggers, staff preference RPC, and absence of an
unresolved application write block. A refused query stops the release without
retrying with writes enabled.

The job builds once with Production settings, stages the prebuilt output with
all four CSF workers disabled, and checks the application SHA, environment,
database, deep table reads, login, and protected route authentication. It saves
only deployment IDs and commit identities before moving the public alias. A
failed promotion or public check restores the prior app deployment. No schema
rollback runs. If cancellation prevents verification, inspect the retained
`app-only-release-<run ID>` receipt and verify the alias before another dispatch.
Staged and public-domain machine checks use the existing automation bypass
header. They do not disable the firewall or prove ordinary browser access;
signed-in browser acceptance remains a separate check.

The new release SHA starts with every CSF worker off, even when the previous
release had workers enabled. After the public alias check passes, read the
controls for both SHAs. Restore each previously approved worker through a
separate `enable-production-csf-worker.yml` run against the new, publicly
served SHA, then verify the saved controls and one bounded worker pass. The
communications enable path also requires the exact-release, expiring
[worker monitoring evidence receipt](worker-health.md). Disable remains
available without that receipt. Keep
scheduled post publishing off. Do not call Sheet exports or notifications
healthy from the app release result alone.

This app-only path supersedes the schema-first requirement below only when its
exact live schema checks pass. Database changes still use the separately
reviewed schema workflow. A successful app release does not prove officer
imports or provider delivery.

## Cost-controlled release path

### Reviewed forward migrations

This online path refuses outstanding credential and project-column permission
contractions. Those changes require the reviewed maintenance workflow, because
the previously served app can issue queries the new grants reject. See the
[current maintenance preflight](production-cutover-runbook.md#current-maintenance-preflight).
An evidence override does not waive this ordering requirement. Already-applied
changes can still be reconciled without another mutation.

`Apply accepted forward migrations` applies only the migration names and SQL
hashes listed in `scripts/production/forward-migration-allowlist.mjs`. It accepts
explicit release and hosted-acceptance SHAs, verifies their identical trees and
successful checks, and uses the Production environment's existing management
credential. The controller verifies the complete ledger and applies only the
remaining approved suffix, with its exact ledger entries, in one transaction.
The lock timeout is five seconds. A lost response triggers read-only ledger and
catalog reconciliation, never another write attempt.

This path does not export or restore data, deploy an app, change approvals,
commit imports, or enable workers. It does not replace the recovery workflow
for other schema changes. After its catalog checks pass, use the app-only
workflow with the already accepted application SHA. Controller-only changes
do not require another Development application deployment.

Build and test feature work locally. Keep related fixes on worktrees or local
branches until one release candidate is ready. The root repository uses one
integration pull request into `development`, followed by one Production pull
request from `development` into `main`. Merge that Production pull request with
a merge commit so the hosted-accepted Development SHA remains an ancestor of
`main` and the resulting tree stays identical. Squash and rebase promotion are
not supported by the Production schema gate. If the private plugin changes,
merge one private integration pull request first and update its exact gitlink
in the root integration pull request.

Vercel Git deployment is enabled only for `development`. It is disabled for
feature branches and `main`. The repository-owned ignored-build command applies
a second check:

- `main` never builds from a Git push. The protected Production workflow owns
  the one schema-first application release.
- `development` builds when the final commit subject contains
  `[deploy-development]`, or when GitHub merge-commits a branch named
  `codex/csf-integration-*`.
- Ordinary `development` commits and feature branches skip dependency install
  and application build.

Put `[deploy-development]` in the final commit subject for either a squash or
rebase merge. A marker in the body or pull request title alone is not
sufficient. A merge commit from `codex/csf-integration-*` needs no extra marker. The hosted
CSF acceptance workflow uses the same rule, so one
Development build and one acceptance run cover the exact release SHA. Manual
acceptance dispatches may check a SHA that already has a successful Vercel
status. They do not create another deployment.

The Production pull request must still use a merge commit. Its merge creates no
Vercel deployment. The protected workflow verifies the accepted Development
ancestry and tree, confirms the Vercel project and Production Branch, pulls
Production settings, and builds the exact application bytes on the GitHub
runner. Before it pushes the schema, the workflow stages the exact prebuilt
application without moving domains, proves its embedded SHA, blocks application
writes, promotes the verified maintenance deployment, and verifies the
Production alias. It then applies and verifies the database migrations and
checks the staged application's environment, database, and deep table reads.
The workflow promotes that application,
verifies that `lets-assist.com` points to its deployment id, and only then
reopens application writes.

Do not re-run a failed or cancelled Production workflow. Recovery receipts bind
to one run attempt, so later attempts stop before provider access. The separate
failed-release workflow requires Production Environment approval, keeps writes
blocked, and restores the verified maintenance deployment. Start a fresh
Production dispatch only after that reconciliation succeeds.

Do not open a new pull request or push a release marker for each fix. Amend the
same local candidate, run focused checks as it changes, then run the full local
gate once before the integration pull request. Production still requires its
separate migration, provider, and browser gates.

Speed Insights Plus is a Vercel account subscription, not a repository flag.
The application keeps the Vercel-only Speed Insights client so the free project
telemetry boundary remains intact. Turning Plus on or off must not require a
source commit or deployment.
