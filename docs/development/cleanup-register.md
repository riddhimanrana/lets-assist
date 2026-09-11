# Repository cleanup register

This register separates actionable repository defects from provider/account and Production-readiness blockers. A finding leaves the active section only when fixed with evidence, disproved with evidence, or moved to the external section with a named dependency.

The authoritative current release status begins at **Repository-owned P0–P2**
below. Every dated implementation narrative before that heading is historical
evidence and does not override the current tables or release gates.

`AUD-` identifiers are allocated per branch and can drift while several audit branches are open at once. Current `development` includes the merged #152, #158, #174, #177, #179, and #181 findings, while open #180 can still carry overlapping historical identifiers. This branch retains `AUD-036` and `AUD-037` for its activity/partner authorization work without renumbering or restating the merged meeting findings.

## Release continuation, 2026-09-05

### Grouped acceptance and test-tool review, September 9, 2026

Production PR #497 merged as `456a46e9c1811902788d3c84b82ba8c8aa4d9861`.
The administrator merge bypassed only the ancestry-based behind status after
quality passed. A merge-tree check proved the merged tree matches Development.
The selected application remains the accepted `d8faa1c1`; the later six-file
change contains test tools and documentation, not application changes.

Migration run `34306190813` refused before writing because the previous release
still had two workers enabled. Worker transitions `34306332659` and
`34306334582` disabled imports and workbook refresh and verified public posture.
Run `34306472878` then applied all eight reviewed migrations, leaving the exact
468-entry ledger. Its final catalog verification failed, so no migration retry
was dispatched.

Read-only comparison found equal definitions and permissions, with only index
array ordering different on two new tables. The snapshot query had used each
database's default text collation. Added explicit C collation to index-definition
ordering. The complete catalog query now passes against both Production and
Development with the original expected digests unchanged. All other catalog
checks passed before this correction. Forty-five focused release tests and
targeted zero-warning lint pass. This is a release-controller correction, not a
schema change, permission relaxation, or new application build.

Accepted Development application: `d8faa1c13851d26e5782baca048fe4381cb05302`.
Private gitlink: `09c36d6750e5ce4685443c33df236111bee20177`.
Vercel deployment: `dpl_9eu2dAfrxoxGfDcaLbBNubESbTJj`.
Quality and database run `34302360181` passed, including 89 CSF browser tests
and four explicit skips. Hosted acceptance `34302357521` passed 9,742 requests
with zero errors, read p95 1.19 seconds, read p99 1.57 seconds, mutation p95
1.38 seconds, LCP p75 1.35 seconds, INP p75 32 milliseconds, 25 crash-free
review navigations, and retained heap growth of -11.1 percent.

Hosted fictional application approval and rejection passed through the officer
UI. Approval receipt `e7ef75e1-30f5-4c81-8d7e-c9ee04380f4c` retained the alumni
class and Spring 2026 accepted membership. Reload preserved Approved and a
zero pending count. Rejection receipt `d32dd65b-99be-4a83-a554-e625316af79b`
stored the reason and created no accepted membership. Automatic application
updates saved On, Paused, and On again in the fictional tenant. No real student
application decision was made.

Workbook preparation run `34304655449` verified four populated previews and
four empty templates. Import run `34304844258` completed 193 rows in one
semester, then stopped with 163 of 167 rows successful in another. Four rows
have `constraint_refused` receipts, not unknown outcomes. The remaining
129-row queued semester was not attempted by that run. Do not call the whole
workbook journey complete or retry failed rows without reviewing their evidence.

PR #497 review follow-up: the current SQL range matcher captures `A1` versus
`A2`, so changed start rows fail comparison. The existing pgTAP changed-first-row
case passed in the accepted replay. End-row growth remains permitted under the
reviewed recurring-sheet policy. No historical SQL was edited.

Two internal test-tool defects were confirmed. The delivery checker now requires
one effective database-mode worker status with the expected flags before reading
controls or calling the worker. The legacy single-workbook `prepare-test`
operation now refuses before any request because the route also processes other
automatic queues. A preflight of one refresh job cannot fence all concurrent
automatic work. Normal application workbook processing is unchanged. Focused
checks passed 14 tests and 74 assertions; TypeScript, targeted zero-warning lint,
and strict gitlink validation passed. These are tooling-only changes and must
not trigger another application deployment.

Fresh Production revision checks passed for 2027, 2028, and 2029. Class of 2030
prepared version 181 as eight empty templates with zero profiles or semester
memberships. Saved immutable payload comparisons verified 4,434 activity labels
and points and 1,392 attendance labels. The 2027 skipped row adds no retained
credit beyond its successful dominant row; the parser recorded that reason.
These checks do not prove Production application imports or email settlement.
Production remains on the previous public release until staged promotion passes.

### Historical application acceptance recheck, 2026-09-08

Provider side effect: opening root PR #496 automatically created ephemeral
Supabase branch `a7208de5-2159-4397-af08-a31b7a5180dc`, project
`bhrrnsdmecwortrecakr`, with `with_data=false`. This conflicted with the selected
no-extra-hosted-branches boundary. Deleted that exact temporary branch and
verified that only main/Production and the existing persistent Development
branch remain. No Production or Development data was removed. The disposable
branch has no retained data to recover and is not release evidence. Further
pushes must wait until automatic branch creation is disabled or otherwise
prevented. Chrome still reports the Mac locked, blocking that dashboard setting.

Vercel reported `Canceled by Ignored Build Step` for root `2bea7093`, confirming
the feature-branch application build was skipped. GitHub run `34234185743`
continues independently; its isolated database started successfully and pgTAP
was observed running. No acceptance result is claimed before the job settles.

Grouped root integration published as
`2bea70938d3f6da0217fa323f5f30061921527ba` on the existing
`codex/csf-scheduling-retirement` branch. Root PR #496 targets Development and
pins private merge `ce8d607b9f0225ad51121b956c404e98f64c8426`. Code quality run
`34234185743` was observed queued for that exact root SHA. Its existing jobs
cover the isolated database and browser prerequisites. No deployment marker
was added, no Vercel build was requested, and no hosted migration was applied.
This is a review candidate, not a Production-ready or imported-data claim.

Root build preparation: the first local build compiled and passed TypeScript,
then failed prerendering because this worktree had no public Supabase client
key. Repeated with the repository CI URL `https://ci-preview.invalid` and its
nonfunctional publishable key; the optimized build and postbuild completed.
No environment file changed and no real backend credentials were added. Keep
both logs, `.artifacts/csf/root-candidate-build.log` and
`.artifacts/csf/root-candidate-build-isolated.log`. This proves local build
compatibility only, not hosted Development or Production workflow acceptance.

Private merge completed: quality run `34233208795` and GitGuardian passed for
`7ca421eb1f0b4cd6c915b703e20c3af574b6c379`. PR #269 merged into private
Development as `ce8d607b9f0225ad51121b956c404e98f64c8426`; its tree exactly
matches the tested candidate. The local private checkout is detached at that
merge and the root index now pins it. The strict submodule check passes. Root
lint passed. The root test rerun reached 1,342 passes and one failure in its
205-file final group because the audit inventory required the old indexed
gitlink to match the new private HEAD. The private merge and index update
resolve that mismatch; focused confirmation follows before root publication.

The focused audit-inventory suite now passes six tests with 20 assertions at
the updated index, confirming the prior mismatch is resolved. Its log is
`.artifacts/csf/root-gitlink-inventory-tests.log`. The officer runbook now names
private Development `ce8d607`. A local Production-mode build has started; no
hosted deployment has been requested.

A fresh read-only Production query returned 460 applied migrations through
`20260906085350`, four linked class workbooks, and zero chapter applications.
These counts confirm that official application import is still required. This
continuation merged private source only; no public deployment or database
mutation occurred.

Private CI repair: PR #269 run `34232694617` failed its source-size check after
the independent application gates. Formatting expanded `import-commit.ts` to
813 lines, `import-preview.ts` to 825, and the security test to 1,202. Extracted
database error classification and preview failure reporting into server-only
helpers, and moved the profile-search limit contract into its own test module.
No transaction, authorization, or worker routing rules changed. Source layout
now passes locally. The 301 existing test files passed, followed by 15 new
helper tests with 17 assertions. TypeScript and private zero-warning lint pass.

Pushed the repair as `7ca421eb1f0b4cd6c915b703e20c3af574b6c379` to the same
private PR. Evidence logs are `.artifacts/csf/private-module-split-tests.log`,
`.artifacts/csf/private-module-split-typecheck.log`, and
`.artifacts/csf/private-module-split-lint.log`. The earlier failed run remains
evidence; its successful security scan does not replace pending quality checks.
No root gitlink update, merge, deployment, or database mutation occurred.

Private candidate publication: pushed exact commit
`3dc3576866494d46c38a5b250c1cfa19a7223e13` to the existing
`codex/csf-import-review-feedback` branch and opened grouped private PR #269
against Development. Its Private Plugin Quality run `34232694617` was observed
in progress on that exact SHA. No merge or workflow success is claimed yet.
The two new host imports already exist on root Development. Root integration
will retain the reviewed forward migrations and worker changes together after
the private merge. No Vercel deployment or database mutation was triggered.

Root formatting preparation corrected four candidate files only: the cron
auth probe, two release test modules, and the reviewed workbook-link catalog.
The affected suites passed 49 tests, including all 465 cron-probe assertions.
Their log is `.artifacts/csf/root-formatted-candidate-tests.log`. No SQL bytes
changed, so the reviewed migration digests remain unchanged.

Grouped private candidate saved locally as
`3dc3576866494d46c38a5b250c1cfa19a7223e13` on the existing
`codex/csf-import-review-feedback` branch. The private worktree is clean. Its
85 changed TypeScript files contain the import authorization, recovery,
chapter application, consent controls, and review fixes developed in this
continuation. A limited credential-pattern scan returned zero signals; it is
not a substitute for release security review. Formatted only those candidate
files, leaving unrelated private formatting debt unchanged.

Formatting exposed five whitespace-sensitive assertions. They now tolerate
line wrapping while preserving their action, consent, and UI checks. The
focused 17-test suite passed with 83 assertions; all 300 private test files
passed afterward. TypeScript, private zero-warning lint, and diff checks
passed. Logs are `.artifacts/csf/private-formatted-candidate-tests.log`,
`.artifacts/csf/private-formatted-candidate-typecheck.log`, and
`.artifacts/csf/private-formatted-candidate-lint.log`. This commit is not pushed
or merged. The root gitlink remains unchanged pending the private merge. No
deployment or Production data change occurred.

Plugin release-gate follow-up: the full local plugin check found two missing
host import declarations, `@/services/google-sheets-csf` and
`@/services/google-sheets-report`. Both modules already exist on remote
Development. Regenerated the host-module catalog with only those two additions.
The boundary check and complete `bun run plugin:verify` then passed, including
independent application checks and all 300 private-plugin test files. The log
is `.artifacts/csf/release-plugin-gate.log`. This gate permits working-tree drift;
it does not replace the strict publication gate.

Remote branches still report root Development
`e4a2a01143fdf02029ff5be52758022f2d568eec`, root main
`82ab06b6c6354c1d7cefed46b73687f75e58e714`, and private Development
`b2b933917f1b41a5bd90d7fc7c613d9ca26b86bb`. Docker again reports that Desktop
cannot start. The existing manually dispatched full Code quality workflow
includes isolated replay, pgTAP, CSF scale and import scale, and browser
journeys. These remain unfinished for this candidate. No new remote commit,
workflow run, deployment, or database write occurred in this continuation.

Current-mapping display follow-up: Settings previously selected the latest
preview by source file without checking its mapping version. It could offer
approval that the server would reject after an officer changed columns.
The reader now uses the existing source/file/version/sealed-preview check for
both grouped readiness reads and the displayed review candidate. It preserves
successful historical commits, shows a stale-mapping notice, and does not fall
back from a running preview to an older completed one. Updated copy also
acknowledges explicitly enabled automatic updates instead of claiming every
import requires another manual approval.

The focused existing suites passed 29 tests with 133 assertions. All 299
existing private-plugin test files then passed in the isolated runner. A new
dashboard behavior suite passed three tests with ten assertions separately,
covering stale, current, and running previews and the actual database-read
selection. Evidence is `.artifacts/csf/class-current-preview-private-tests.log`.
Targeted lint and the implementation TypeScript check passed. This is local
evidence only. No push, deployment, migration, or official data write occurred.

Migration-controller review follow-up: reviewed the four pending candidate
migrations and added their exact SHA-256 digests to the existing two-file
release tail. The controller still requires the exact 460-version starting
ledger, disabled workers, one transaction, and catalog and permission checks
afterward. Tests reject modified bytes in each of the six files and reject a
matching ledger with a changed schema catalog. The focused release and catalog
suites passed 33 tests; targeted zero-warning lint passed. Evidence is
`.artifacts/csf/forward-release-candidate-tests.log`. No migration was applied.
The full root rerun passed all 307 discovered test files with mock-sensitive
files isolated. Its log is `.artifacts/csf/release-candidate-root-tests.log`.
The earlier failed run described below is retained as historical evidence.
Strict gitlink publication, database replay, hosted acceptance, and live
Production reconciliation remain separate, unfinished release checks.

The chapter-wide application layout suite also passed 23 tests with 69
assertions, including original-semester class resolution from Fall 2023 through
Spring 2026, Fall 2026 mixed grades, alumni, and a blank leading column. These
are fictional parser checks, not Production import receipts. Every historical
application source remains in scope. Chrome again reports the Mac locked, so
signed-in officer reconciliation has not resumed.

Grouped release gate follow-up: full repository lint passed. Static migration
validation passed with 67 existing missing-description warnings; it performed
no replay or database writes. The strict private-submodule gate correctly
refused the dirty working branch. Root HEAD remains
`e370d45743fbb58a3f15e289723cb2479514d0c6`, with indexed and checked-out private
HEAD both `b2b933917f1b41a5bd90d7fc7c613d9ca26b86bb`. Uncommitted candidate changes
are not represented by either released commit. No build gate was bypassed.

The root test run found a missing mock export when its cron-auth probe imported
the new Sheet workers. The probe now mocks each automatic worker at its dispatch
boundary and counts calls, so its no-dispatch assertions cover application
refresh, class metadata checks, and class preview dispatch. Its focused suite
passed 16 tests with 465 assertions and targeted lint passed. The full root
rerun reached the remaining 205-file group with 1,331 passes and two failures.
One was stale runbook ledger text, now corrected to distinguish the 466-file
candidate from Development's 462 applied migrations. Its focused 13-test,
304-assertion contract passed. The other is the forward-release controller's
exact-tail guard: it still approves only the older two migrations. Updating
that controller requires final review of the four additional candidate bytes;
its refusal remains an open release gate, not a test to suppress. The full root
suite is not green. Logs are `.artifacts/csf/release-candidate-root-tests.log`
and `.artifacts/csf/release-documentation-contract.log`.

A read-only Vercel lookup of `lets-assist.com` returned Production deployment
`dpl_8P2hHJAPCLLkyH6NdpxDw2HmPjtF`, READY for release
`82ab06b6c6354c1d7cefed46b73687f75e58e714`, app-only run `34058086857`.
This confirms the older release, not the local follow-up. Chrome still reports
the Mac locked. No new deployment, provider change, or official import ran.

Independent registration follow-up: a known saved-mapping mismatch now records
a protected source review log and returns the blocked semester instead of
throwing out the whole workbook preparation. The link worker skips that term's
preview and excludes its sources from retirement. Other terms still register
and prepare. Returned linked/template counts exclude failed registrations;
blocked terms remain explicit in the worker result. Consent-read errors and
failure to save the review log still stop processing as uncertain failures.

The source-registration suite passed 13 tests with 48 assertions. The worker
suite passed six tests, including a first-term mapping conflict, later-term
preparation, and protecting the blocked term from source cleanup. An initial
combined Bun invocation contaminated these two suites through module mocks;
the repository's isolated test runner passed all 299 private-plugin test files.
Its log is `.artifacts/csf/class-independent-registration-private-tests.log`.
TypeScript, targeted zero-warning lint, and diff checks passed. No schema,
deployment, or Production data change occurred. Official imports and the
remaining release acceptance are still unfinished.

Paused mapping follow-up: source registration previously preserved officer
corrections only while automatic consent was active. Paused, blocked, reconnect,
and manual sources could receive detected default columns and one-point rules
on the next refresh. Registration now preserves the saved mapping for the same
file, owner, class, semester, and column layout. Non-active sources update their
row range and population state through the ordinary versioned registration,
without enabling automatic updates. Active consent retains its existing bounded
row-expansion behavior. Layout drift refuses replacement before any source write.

The focused suites passed 34 tests with 68 assertions, including all four
non-active states, retained point rules and columns, current row ranges, and
layout refusal. TypeScript, targeted zero-warning lint, and all 299 private-plugin
test files passed. The full log is
`.artifacts/csf/class-paused-mapping-private-tests.log`. No schema
change or Production write is part of this correction. This does not finish
future-tab authorization or official import acceptance.

Class consent controls follow-up: class Settings now exposes the existing
audited automatic-update control beside each linked semester. The read model
adds the preview's mapping version to its existing bounded job query, with no
additional database request. Enable is available only for the exact source and
file with a sealed current-mapping preview. Stale or missing previews still
allow an officer to load saved status and pause authorization. Opening Settings
does not authorize a source. Collapsed controls do not mount the status reader.
Class wording names activities and attendance; application wording still keeps
decisions with officers. Existing shadcn fields and confirmation controls are
reused rather than introducing a separate settings form.

The focused projection/controller suites passed 22 tests with 47 assertions.
TypeScript and targeted zero-warning lint passed. Two source-text regression
assertions needed updates for the extracted wording and added mapping-version
projection; the behavioral wording and replaced-file checks remain covered.
All 299 private-plugin test files then passed. The log is
`.artifacts/csf/class-consent-controls-private-tests.log`. This is local code
and test evidence, not a browser or hosted acceptance result. Future-tab
authorization, unchanged new-preview replay, official imports, and the grouped
release remain open. No migration, commit, deployment, or Production mutation
occurred in this follow-up.

Populated class commit follow-up: the new rollback-only database test opens and
seals a fenced preview with two safe fictional rows and one uncertain sibling.
It completes the workbook generation, dispatches automatic approval, refreshes
source evidence, claims the commit attempt, and commits through the existing
batch function. All 16 assertions passed. Both profiles share one activity with
the exact label and point value. Two attendance records retain their semester
and named meeting links. Replaying the batch keeps one batch receipt, two row
outcomes, and no duplicate profiles or participation. Finalization reports two
committed records, zero unknown outcomes, and partial completion because the
uncertain sibling still needs review. The initial fixture used `present` as a
normalized attendance status; the corrected fixture retains that source value
and uses the parser contract's `attended` status. No application behavior changed.

Post-test verification confirms 462 applied Development migrations, no candidate
authorization table, and no retained fictional organization. The historical
application suites again passed 51 tests with 130 assertions. A fresh read-only
Production query still found zero imported term applications for DVHS CSF.
Older applications across all source classes and alumni remain in release scope,
but official import completion is not established. Chrome still reports a locked
Mac. A new-preview unchanged sync, official officer actions, class consent
controls, future-tab authorization, and the grouped release remain unfinished.
No commit, deployment, applied migration, or Production write ran in this check.

Automatic class metadata follow-up: the local worker now claims one due
source-authorized workbook check alongside existing class preparation and
application refresh. It uses the existing workbook worker switch and returns
count-only outcomes. The database enforces the shared five-minute workbook
interval, current officer consent, Google owner access, and both leases. An
unchanged version creates no preparation job; a changed version enters the
existing queue. It does not mark a preview prepared or approve import rows.

The new rollback-only database suite passed 21 assertions. The metadata service
passed 20 tests with 41 assertions, and the worker route passed 20 tests with
58 assertions. TypeScript and targeted zero-warning lint passed. The release
catalog now checks all 21 functions in candidate migration 466; its 22 unit
tests passed, and the complete four-migration candidate returned
`csf_target_schema_verified=1` in a rolled-back Development transaction.
Development remains at 462 migrations, the candidate tables are absent, and
the fictional test organization count is zero after rollback.

Class preview binding to source consent and automatic ready-row approval still
need completion and acceptance. Metadata checking alone does not implement
those steps. No private or root commits, deployment, Production mutation, or
official import occurred in this follow-up.

Class preview consent follow-up: the local preview action now records the
active source authorization ID, generation, read scope, and provider version
before constructing a new immutable class preview. These values also enter
the preview identity hash. Only an already validated class-workbook worker
uses this path. The check binds the exact organization, source, Google owner,
mapping version, and reviewed header signature. Missing or paused consent
does not become automatic authority; a failed consent read or changed active
mapping refuses preparation. Existing manual previews are not rewritten.

The 17 focused tests passed with 23 assertions. TypeScript, targeted
zero-warning lint, and all 295 private-plugin test files passed. The local
test log is `.artifacts/csf/class-consent-private-tests.log`. This finishes
preview-side attribution only. Commit-side validation must still distinguish
the Google owner who prepared the workbook from the officer who authorized
updates, and class preparation must retain consent across allowed row growth.
Automatic ready-row queue integration is still unfinished. Chrome again
reported a locked Mac; no live officer action or Production change occurred.

Class row-growth follow-up: rediscovery previously changed the stored row
range and replaced the reviewed mapping with detected defaults. For a current
automatic class authorization, registration now retains the stored tab mapping,
column corrections, point rules, duplicate policy, and caller-owned settings
when only row bounds change. It does not bump the mapping version. The preview
expands its row read using current workbook capacity, without expanding approved
columns or exceeding the existing cell limit. Different columns, header position,
class, semester, owner, or file do not reuse consent. An incompatible active
mapping stops registration before overwriting it. New manual sources remain
manual. This does not yet implement automatic consent for newly discovered tabs.

The retained-mapping suite passed 23 tests with 26 assertions, preview consent
and expansion passed 22 tests with 29 assertions, and registration behavior
passed four tests with 12 assertions. TypeScript, targeted zero-warning lint,
and all 297 private-plugin test files passed. The full test log is
`.artifacts/csf/class-row-growth-private-tests.log`. Commit-side authorization
and automatic ready-row queue integration remain the next implementation work.
No schema changes, commits, deployment, or Production mutations occurred.

Class commit-authorization follow-up: candidate migration 466 now includes
`csf_queue_automatic_class_preview`. It validates the authorizing officer and
completed workbook generation before advancing the source preview checkpoint
and calling the existing safe-row queue in the same transaction. Queue refusal
rolls back the checkpoint. The shared automatic guard accepts the recorded
Google owner as a class preview's preparer only when that owner, class, source,
workbook job, current provider version, and reviewed consent all agree. It
still requires the authorizing officer for approval. Application preparers
retain their existing authorization rule. Old manual previews are refused.

The new class authority test uses the real fenced preview open, seal, and
workbook completion functions. Its 15 assertions passed, including separate
officer/Google-owner roles, provider drift, changed headers, cross-organization
refusal, pause, and empty previews creating no profiles or approvals. The
existing application consent suite passed all 51 assertions. These tests do
not yet prove a populated class automatic commit; that replay remains open.

The release catalog now pins all 22 candidate functions. Its 22 unit tests
and targeted lint passed. The complete four-migration candidate again returned
`csf_target_schema_verified=1` inside a rolled-back Development transaction.
Post-test verification confirms 462 applied migrations, no candidate authority
table, and zero remaining fictional organizations. The worker still needs
durable discovery and dispatch of completed automatic class previews. No
Production changes, applied migrations, commits, or deployment occurred.

Automatic class dispatch follow-up: candidate migration 466 now discovers the
latest consent-backed class preview for each active source, only after its
workbook generation completes. It rechecks the source checkpoint under locks
before entering the checked queue function. Known permission or source-evidence
refusals record a blocked source state. Other database errors remain uncertain
and do not become approvals. The existing workbook worker dispatches up to eight
previews per run, independently of newly queued workbook jobs. Review-only or
blocked terms do not stop later terms; an unknown result stops without retry.

The class database suite passed 19 assertions, including discovery after
preparation and an idle second dispatch after the saved checkpoint. It still
uses an empty class preview and does not prove a populated automatic commit.
The dispatch service passed nine tests with 62 assertions and the worker route
passed 22 tests with 65 assertions. TypeScript, targeted zero-warning lint, and
all 298 private-plugin test files passed. The full log is
`.artifacts/csf/class-dispatch-private-tests.log`.

The release catalog pins all 23 candidate functions. Its 22 unit tests and the
full candidate catalog check passed. Rolled-back Development verification
confirmed 462 applied migrations, no candidate authority tables, and zero
remaining test organizations. Populated class commit/repeat-sync acceptance,
class consent controls and future-tab authorization, official data imports,
and the grouped release remain open. No Production change or deployment ran.

The release scope includes older chapter applications for every source class,
including alumni, as well as Fall 2026. Source semesters remain authoritative;
the current class filter must not retarget historical responses. Importing a
response remains separate from approving it.

A fresh read-only Production check found one DVHS CSF organization and zero
imported term applications. Its latest application preview per source contains
588 rows: Spring 2026 has 514 ambiguous rows, two conflicts, and one resolved
pending row; Fall 2026 has 71 ambiguous rows. These are preview counts, not
unique applicants or committed records. This query does not establish coverage
of older Sheets or current provider revisions.

The local application layout, retry lineage, chapter-wide import scope, and
source review-period suites passed 51 tests with 130 assertions. Coverage
includes Fall 2023 through Spring 2026 class derivation, Spring 2026 alumni,
mixed-class Fall 2026 responses, and preserving closed review periods. These
tests use fictional records and do not prove official imports. Chrome still
reports a locked Mac, so no officer reconciliation or commit ran in this check.
No deployment, migration, or Production data change occurred.

### Development credential verification, 2026-09-07

Tooling commit `5594572dea3cd2d92a2bd76d1620830e8f4ec519` reached
`development` without a new PR or deployment marker. Its hosted acceptance job
correctly skipped. One configuration-only redeployment,
`dpl_AeV3QCXGTexX5oupuYBMFPHuKSAF`, reached READY and serves
`dev.lets-assist.com` at accepted application SHA `e8e4c63b`. Production's
application and database were not changed.

Run `34174136150` proved the replacement Development workbook key authenticates
with processing disabled. Run `34174172884` invoked preparation once and received
HTTP 503. Job `63bfc5fb-6738-4564-8dc4-69c1cf0fe4e5` recorded attempt 1 but
no completion receipt, sources, or previews. Do not invoke it again without
resolving that outcome. The generation assertion passed while its lease was
active. The fictional class has only F26 configured, an independent fixture
gap before the four historical populated tabs can pass acceptance. The exact
cause of the unfinished worker receipt remains under diagnosis.

Audited control receipts `7dfe3b87-2732-4a52-9501-c494e869f698` and
`bbeb7e0c-17e7-4c17-95e5-065f148baaf8` enabled and then disabled only workbook
refresh. Revision 2 leaves every worker disabled. The checker also used the
wrong active-job label, `processing` instead of `running`; a failing regression
now passes with the corrected query. All eight focused checker tests pass.
That correction remains local for the next grouped tooling update.

The app's source recheck subsequently found provider version `10` and queued
job `94d723d1-d0f7-4c77-839d-b3051473d0ba`. The previous job had frozen
version `9`. A guarded invocation of the existing queue function settled only
that expired old generation as `blocked/stale_workbook_generation`, preserving
attempt 1 and creating no new claim. This establishes stale source evidence,
although the original 503 did not retain its internal failure stage.

The signed-in fictional officer added the seven missing semester records through
the app's repair form. Database verification confirms all eight source terms,
with only F26 current. No profiles, participation, or application decisions were
created by those setup actions. Run `34174922514` now checks the fresh version-10
job. It passed: authenticated HTTP response and durable receipt both report
one claim, four prepared populated tabs, four templates, and zero blocked tabs.
Control receipt `6ee45649-7ad1-47a0-a93e-5920e75fd83d` returned every worker
to disabled at revision 4. No new build was needed for these operations.

Browser review then exposed a separate row-level refusal. The F24 source's
column O is All Reqs Met, calculated with IF/AND from activity slots and meeting
attendance. It is not a points total. The preview rejects every F24 row because
that retained status field contains a formula. The other populated previews
also require row review. Preparation completion does not prove row commit
readiness. Preserve calculated-status provenance without converting it into an
application approval; diagnose the rule before rebuilding or committing.

The local formula fix passes 49 focused parser and preview tests, all 273
private-plugin test files, TypeScript, and zero-warning lint. Recognized
calculated completion markers are accepted only in a separate class-history
field. Shared identity/contact/activity/meeting mappings do not get this
exception. Protected source evidence records the original coordinate and
whether the value came from a formula. Application formulas and spreadsheet
errors remain blocked. Chrome access is restored in the Riddhiman profile;
the deployed preview still has the old refusal. No test rows were committed
and no Production change was made during this fix.

Private PR #265 passed CI `34176034001` and merged into private Development
at `7daadc1f2786b39ebaffd58c5bf8ea187ae0f477`, with the tested tree from
`da1ca26bcac527608d5f3d640e3edbed16e58593`. The local plugin verification gate
also passed. Root integration and hosted formula acceptance remain open.

Root PR #492 at `33804924` failed CI `34176279852` before deployment.
The database job could not start because port 55324 was occupied. The quality
job found one stale runbook reference to the preceding private commit. The
runbook now names `7daadc1`; its 13 documentation contract tests pass locally.
The complete local rerun passes all 305 root and 302 plugin test files.
The original failed run remains recorded. No migration or hosted build ran.
Read-only Production verification still reports 1,047 profiles, four linked
workbooks with eight currently prepared tabs each, and zero applications.
The two existing application previews contain 585 ambiguous rows, two
conflicts, and one resolved row. Importing responses remains unfinished.

### Calculated-status database contract failure, 2026-09-07

Root PR #492 passed CI `34176893568` at `bfc3bddd`, including the database
replay, 88 CSF browser tests, and three DV browser tests. Four configured CSF
skips remain separate from acceptance. The merge at
`8a48f7a1c733b94ec452dd49eb49ee7782ddb081` has the identical tested tree and
private pin `7daadc1`. Development deployment
`dpl_Ctx7tj7zpiKzYyr4LqJwzYEEYPNz` is READY on that SHA. Hosted acceptance
run `34178004263` is still running. Production has not changed.

Chrome confirmed an audited rebuild request for the fictional workbook.
One-shot worker run `34178593288` authenticated and claimed the version-10
job, but returned HTTP 503. Preview `7aca77e1-0aea-4f98-83ee-fd39a2251f1e`
failed while appending F24 rows. Its protected diagnostic identifies the cause:
the database rejects the new `sourceEvidence.requirement` field as unknown.
The parser-only fix is incomplete. A forward migration must validate the bounded
requirement evidence and include it in the source-evidence digest. Add a pgTAP
case through the actual append RPC, not only a mocked preview writer.

Refresh receipt `94d723d1-d0f7-4c77-839d-b3051473d0ba` retains attempt 1
without completion. Do not blindly retry it. Control receipts
`63ea8149-ebf3-47b8-b075-c869e0d9dd11` and
`d5e836ea-c93e-4fae-adf1-69a8f0b2e6d0` enabled and disabled only workbook
preparation. Revision 2 leaves every worker disabled. No test rows committed.

Read-only Production counts separate 736 active profiles from 311 merged
profiles. Directory counts are 347 for 2027, 281 for 2028, and 108 for 2029;
2026 and 2030 have no active directory profiles. These are not current-semester
membership counts. Applications remain unimported. Among 585 ambiguous preview
rows, 465 have one exact name-and-class candidate, 119 have none, and one has
multiple candidates. These counts guide review; they do not prove identity or
authorize matching by name alone.

The temporary private branch `codex/csf-calculated-status-evidence` was removed
locally and remotely after verifying its exact tip and ancestry in private
Development. Its code remains in merged `7daadc1`. Other worktrees remain intact.

Forward migration `20260908020559_csf_requirement_source_evidence.sql` now
extends the append RPC's closed contract. It validates the optional requirement
object and includes it in the evidence digest only when present. Existing
digests, approval payloads, and server-only execution grants remain unchanged.
The append-RPC pgTAP suite expands from 14 to 30 assertions, including formula
markers, blank values, literal provenance, rejected fields, tampered digests,
and unchanged commit payloads. Migration file checks and strict gitlink checks
pass. Docker Desktop cannot start, so commit `f08dbf9a` is under the existing
manual CI workflow `34179939118`. Its isolated database startup and database
test steps passed; remaining steps are running. Vercel reports "Canceled by
Ignored Build Step" for this branch push. No provider migration or new
deployment has run.

Hosted acceptance `34178004263` passed on `8a48f7a1`. It used 100 distinct
fictional identities and sessions, with 9,775 requests and zero request or
browser errors. Aggregate reads measured p95 1,436.547 ms and p99 2,186.279 ms.
Classes measured p95 1,627.064 ms and p99 3,318.274 ms; Applications measured
p95 2,146.171 ms and p99 3,549.940 ms. Mutation p95 was 1,862.744 ms.
LCP p75 was 1,532 ms, INP p75 32 ms, and CLS p75 0.000816. All 25 review
navigations completed without crashes. Retained heap fell from 40,470,488 to
35,748,056 bytes, or 11.67%. Domain and SHA checks passed before and after
the run. The failed workbook path and unapplied migration remain separate gates.

CI `34179939118` passed database tests but failed 15 root release-contract
tests because the new 462-migration ledger was not yet reviewed by the app-only
catalog verifier and the officer runbook still named 461 migrations. The local
catalog update now pins the exact ledger digest and append function body,
signature, owner, configuration, and server-only grants. Previous release
catalogs remain unchanged; unknown ledgers still fail closed. The full local
run exposed one additional stale migration-tail pin in the forward-release
controller. It now approves the exact bytes of both pending migrations, while
retaining the 460-migration Production baseline and one-write outcome rules.
All 52 focused release and documentation tests pass after that correction.
The earlier full local run failed before the correction and is not a green gate.

The full local test run after commit `9699f756` exited successfully across
305 root and 302 plugin test files. CI `34179939118` finished its complete
database and browser job successfully. Its overall failure retains the earlier
quality-test failures above. Replacement CI `34181210176` runs on exact SHA
`9699f756ee3aeeefe02936e16bb7183fa0947aed`. Chrome is accessible again in the
Riddhiman profile. No Production changes or additional Vercel deployment occurred.

CI `34181210176` hit a runner startup conflict before database replay:
port 55324 was already in use. No migration or database test ran in that job.
Its independent quality job passed the root/plugin tests and reached the build.
GitHub refused an individual database-job rerun while the workflow remained
active. Preserve the passing database/browser evidence from `34179939118` and
retry only the failed job after the current workflow finishes.

The refreshed fictional Development class still shows eight linked semester
tabs. Member search returned the requested fictional profile, an unmatched
query showed no results, and clearing the filter restored the directory.
This ten-member check does not prove search beyond the first page. Development
still has 461 migrations, latest `20260907000344`. The failed workbook job
remains recorded as running at attempt 1; no retry or commit was triggered.

The quality job on `9699f756` completed successfully, including the Production
build. After the workflow finished, GitHub accepted a rerun of only database
job `101920530909` in run `34181210176`. The source SHA is unchanged. This
rerun does not deploy a Vercel application or repeat the successful quality job.

Development PR #493 groups the two commits on the existing branch. Its required
CI run `34181764735` is active on the same changes. Once that replacement was
confirmed running, manual run `34181210176` was cancelled to avoid duplicate
database/browser runs. Retain its successful quality/build result and initial
port-conflict receipt. Vercel's PR check reports `Canceled by Ignored Build Step`.
No application deployment was built for this PR.

The live fictional Applications page opens an organization-wide importer with
both Choose from Drive and Google Sheet link controls. The page states that one
workbook can contain every class. This confirms source selection is available,
not that chapter-wide rows have been imported or reconciled.

A new fictional application workbook was created and uploaded through the
authorized Riddhiman Chrome session into the signed-in chapter Drive account.
Native conversion produced Sheet `12yHSQXsMi69SN7qxw2OZ0Km59Kb17IOaUln-bb7-viE`.
Connector metadata confirms native Google Sheets MIME type and two tabs:
Fall 2026 Responses and Spring 2026 Responses. Each has four fictional rows
using the public 17-column form layout. Grade-derived classes cover 2026 through
2030 across the two semesters. Both native views were checked. Proof fields
remain intentionally blank to test missing-evidence handling without approving
applications. No real response values or evidence files were uploaded. The
application preview, class resolution, reconciliation, and commit are still open.

PR #493 passed CI `34181764735`, including complete database replay and CSF
browser workflows, and merged to Development at
`36c3b74ae43ce0da279acdec51fc15ae3c7c660d`. Vercel skipped the unmarked merge.
Supabase Preview is processing it; the first post-merge read still showed 461
migrations. No Production changes occurred.

The new application Sheet initially failed pasted-link access. Choosing the
same file through the connected Drive picker succeeded and deterministic
analysis mapped the public form headers. Preview submission returned an
interrupted-response message, but source `f2eabc7f-2056-4864-8ec6-76608746f26a`
and preview `f6075ab4-7d53-4ef9-9bf0-a7b86e53fd2f` were saved. Reload reopened
that exact four-row preview without another submission. All four rows retain
Fall 2026. Three identify missing fictional classes 2027, 2029, and 2030;
the 2028 row reached identity review. No applications were committed or approved.
The interrupted response remains an open UI/recovery finding, not a failed
database write. Configure the missing fictional classes before a fresh preview.

Follow-up verification confirms Development has 462 migrations through
`20260908020559`. The append function body MD5 is
`f990db576f8e2c5a1663b2cfeb784677`, with service execution allowed and
authenticated execution denied. No application rebuild was required.

The normal class Settings check queued version 11 job
`ec2d8682-0ae9-419c-82f5-c3c1aedd0ce6`. A guarded call to the existing claim
routine settled the expired version-10 job as `stale_workbook_generation`,
without claiming the new job or repeating writes. One-shot workbook run
`34183419825` passed: four prepared tabs, four empty templates, zero blocked,
one attempt. Enable receipt `615cb9cf-121d-4ea3-8785-80c0d8563da8` and disable
receipt `e7dad196-7ac6-478f-bdc1-ebe82e6c4137` record the bounded test.
All workers are disabled at revision 4. Review, commit, and unchanged repeat
remain unverified. Production remains unchanged.

The fictional officer created Classes of 2026, 2027, 2029, and 2030 and their
semester sets through the normal class setup form. Reusing the file through
Start another import retained the original missing-class preview. The saved
source's Preview action instead created retry
`4bec2360-4f06-4749-ae59-b6c518eaaee6`, linked to the original receipt.
Its four rows correctly resolve Fall 2026 and Classes of 2027 through 2030.
This recovery works, but its location and difference from Start another import
remain a UI finding. Do not report stale target errors as a source-data defect.
Each fictional applicant search returned no existing member. Four audited
new-profile decisions include the fictional source grade and semester in their
reasons. These are identity decisions, not application approvals. Commit and
Spring 2026 alumni checks remain open.

After those decisions, live counts show four ready rows and zero needing review,
and Verify source and commit is enabled. The heading still says Preview needs
reconciliation and Reconciliation required. Record this stale-summary defect
alongside the recovery-path issue; it does not change the verified row counts.
No commit was queued and no application decision was approved during this check.

Local follow-up on private `codex/csf-import-review-feedback` corrects the
preview heading using the sealed state and current unresolved count. Failed,
cancelled, and running previews never become ready from a zero count. The
unresolved-row panel now exposes Recheck preview with the existing source ID,
retry lineage, pending state, and error feedback. No import authorization or
receipt behavior changed. Two presentation regressions and the missing recheck
control assertion failed before the patch. The combined 104 focused checks,
TypeScript, zero-warning lint, and formatting checks pass. The grouped changes
remain local and have not triggered a build or deployment.

Private commit `f3396ab40a116c7c3d9fdadd69b126a4aef1163d` contains that grouped
UI fix and its focused regressions. It is not pushed or integrated into the
root gitlink yet.

Live Spring verification found automatic analysis ignored the pasted tab GID
and chose Fall 2026 Responses. The explicit mapping form correctly selected
Spring 2026 Responses and Spring 2026, with range A1:Q5. Its default List I
total mapping was absent despite the standard header, so the officer selected
Total Points - List I explicitly. The resulting four-row preview preserved
Spring 2026 and correctly resolved Classes of 2029, 2028, 2027, and alumni 2026.
Identity review and commit remain open. Wrong-tab automatic analysis and the
manual List I alias remain findings for the grouped follow-up. No approval or
Production mutation occurred.

Private follow-up `9957d55` preserves the pasted application tab ID through
selection and all analysis retries. Analysis verifies that ID against provider
metadata and reads only that tab, even when it falls beyond the usual discovery
limit. Missing, malformed, or conflicting tab IDs refuse rather than selecting
another semester. Root metadata now retains sheet IDs in its existing metadata
request, without another request or cell read. Both manual mapping forms share
the List I total aliases and exclude combined-list totals. Seven new private
checks, three root metadata/privacy checks, and 27 neighboring analysis and
application checks pass. TypeScript and zero-warning lint pass. The root
metadata change and private commits remain local; hosted verification and the
grouped integration are still pending.

Private PR #266 groups those fixes at `35b1df6`. The final change removes the
hard-coded Class of 2030 historical-preview ban. Content-based discovery still
registers header-only tabs as templates and parses no member rows. Populated
tabs still require configured class terms, source evidence, row reconciliation,
and officer commit. Twenty focused tests cover discovery, link planning, and
Development restrictions, including empty and populated inputs for 2027 through 2031. They pass, as do TypeScript and zero-warning lint. The full private run
passed across 276 files before that final change. The combined root/private run
is still active; do not label it passed yet. Development has 12 completed
commit-queue jobs and no queued or running jobs at this check. No app deployment
or Production change occurred.

PR #266 passed private CI `34185452685` and merged at
`6fb9238592592db8fb9589fd4e70335c846aff54`. The root index now pins that exact
private Development commit, and the strict submodule check passes. The first
combined root run stopped on the audit inventory's expected old-gitlink
mismatch, not a changed callsite. Its targeted six-test rerun passes after
integration. The complete integrated run is active and remains unconfirmed.

The root follow-up adds a Development-only one-shot import check to the existing
manual worker workflow. It validates the exact served SHA, runtime controls,
fictional organization/file identity, one untouched officer queue receipt, and
bounded expected row count. It calls the worker once, then requires both the
queue receipt and every row outcome. A lost response reads receipts without
resending and does not claim HTTP authentication proof. Seventeen import and
workbook-controller tests, TypeScript, and zero-warning lint pass. The checker
is local and unexecuted against hosted Development. It never enables workers,
queues imports, or enters the Production communications job.

### Hosted performance acceptance passed, 2026-09-07

Run `34171163941` completed successfully on exact Development SHA
`e8e4c63b1e1e090885b91f24fe46e2a7e97aab07`, private pin `ef8cce1`.
The fifteen-minute load used 90 member and ten officer sessions with 100 distinct
authentication identities. All 9,737 requests succeeded. Aggregate read p95 was
1,341.321 ms and p99 1,678.441 ms; mutation p95 was 1,836.776 ms.

| Read route           | Requests |    p95 ms |    p99 ms |
| -------------------- | -------: | --------: | --------: |
| Member activities    |    2,930 | 1,025.489 | 1,401.613 |
| Member Home          |    2,923 | 1,155.432 | 1,576.706 |
| Member profile       |    2,925 | 1,044.085 | 1,340.062 |
| Officer applications |      320 | 1,903.888 | 2,351.504 |
| Officer classes      |      319 | 1,577.239 | 1,907.527 |
| Officer Home         |      320 | 1,478.444 | 2,100.110 |

Thirty measured browser samples produced LCP p75 1,400 ms, INP p75 32 ms,
and CLS p75 0.000816247. All 25 review navigations completed without a crash,
console error, page error, failed request, or 5xx response. Retained heap changed
from 40,178,660 to 35,753,592 bytes, a reduction of 11.01%. Keep the previous
failed route measurements as historical evidence rather than replacing them.

The new Development-only workbook checker uses the dedicated workbook key,
checks the exact served SHA and disabled unrelated workers, verifies the lone
fictional source/job before one worker invocation, and reads the saved receipt.
A lost response never invokes the worker again. A recovered receipt does not
pass HTTP authentication acceptance. Its eight tests pass, alongside the six
existing delivery tests and three cadence contracts. TypeScript and focused
zero-warning lint pass. This tooling remains local and has not processed the
queued workbook. No Production promotion or official application import occurred.

The tooling follow-up also passes all 305 root test files, full zero-warning
lint, TypeScript, and strict private gitlink checks. Application modules and
migrations remain unchanged from the accepted tree. General cron configuration
now has independent values for hosted Development and local development. The
existing Production value was retained and its scope narrowed to Production
only. GitHub's Development environment stores the matching hosted Development
cron key. No keys were printed or written to local files, and no deployment was
started during configuration. Runtime isolation still needs verification after
the next grouped deployment; existing deployments retain their old settings.

### Grouped Development release started, 2026-09-07

Root PR #491 merged as `e8e4c63b1e1e090885b91f24fe46e2a7e97aab07` after
CI run `34170168311` passed. Its tree `5253447a651beb9fe92e95267b336dec311133df`
matches tested candidate `c5409f6e`; the private pin remains `ef8cce1`.
CI reports 88 passing CSF browser tests and four configured skips, plus passing
database replay, workflow, scale, quality, and build gates. The release marker
started one Development deployment and hosted acceptance run `34171163941`.
Neither hosted acceptance nor Production promotion is complete.

All four Production class revision checks returned up to date. A separate
read-only database check confirms four workbooks, 32 discovered tabs, four
current prepared versions, and zero application records. These checks do not
resolve identity exceptions or prove application import completion.

The current link/prepare/review/commit/repeat browser journey remains missing.
The existing reference workbook contains 652 fictional rows and four empty
templates. Importing a separate acceptance copy through the Drive connector
failed before creation because the connector requires `source_file.mime_type`
but exposes `source_file` as a local-path string. The user then approved the
Chrome fallback. A native Google Sheet named `CSF synthetic workbook acceptance
2026-09-07` was created from the existing fictional reference through the Mac
file picker and Google's conversion command. Bounded reads confirm all eight
tabs, 652 fictional rows, and four empty templates survived conversion. The app's
Drive picker linked that copy to the existing `csf-delivery-fixture` class,
workbook receipt `249409ba-206d-4de6-a163-47e09016efa7`, provider version `9`.
Google authorization reused existing file-specific access without requesting
Calendar access. The Development refresh queue contains one pending job, scoped
to this fictional tenant, and no other queued or processing refresh jobs.
Preparation, review, commit, and repeat acceptance remain open while workers
stay disabled. The signed-in status page confirms served SHA `e8e4c63b`.
No official source or application record was changed.

The one synthetic refresh receipt is `63bfc5fb-6738-4564-8dc4-69c1cf0fe4e5`,
queued with zero attempts. Development GitHub environment secrets include the
communications worker credential but no workbook or import worker credential.
Vercel stores separate sensitive workbook/import credentials for Development
and Production. Read-only environment metadata also shows one `CRON_SECRET`
entry targeting local Development, Preview, and Production together. This shared
fallback remains an environment-isolation exception. Do not describe credential
separation or hosted workbook-worker acceptance as complete. No secret values
were exported, rotated, or added to the repository during this check.

The user subsequently confirmed that the Development workbook/import keys were
not retained and authorized replacements. Both keys now have matching generated
values stored as sensitive `preview` variables scoped to `development` in Vercel
and as secrets in GitHub's Development environment. Production key metadata is
unchanged. No local secret file or build was created. The first workbook update
with redundant scope/type fields received HTTP 400. A value-only update succeeded
and its matching GitHub value was saved before proceeding to the import key.
These replacements are configuration for the next grouped Development deployment,
not proof that the current deployment uses them. A Development worker runner and
the remaining queue/commit/repeat checks are still required. The shared general
cron fallback remains a separate unresolved isolation issue.

### Grouped private integration, 2026-09-07

Private PR #264 also passed quality run `34168642353` and merged at
`ef8cce14810a82b19699aec3a0c1a627d02def42`, tree
`62d27405e07752a067a6abf41d86a65fe52c8136`. The root index now pins that exact
detached private checkout; strict submodule validation passes. Root integration
is ready to commit. One combined root run failed the audit-inventory assertion;
the isolated test and its unchanged combined rerun passed. The later runbook
check correctly required the newly staged private version, now recorded as
`ef8cce1`. The final complete root run passes all 304 discovered files, with
its output retained in `.artifacts/csf-root-units-integration-20260907.log`.
All 13 release-documentation checks pass, as do seed safety, formatting, and
the 114-module host-import boundary. No failing assertion was removed.

The signed-in Riddhiman Production session is available again. Its Class of
2029 revision check reports the workbook is up to date, with 62 Fall 2025 rows
and 88 Spring 2026 rows marked imported. This is an existing-workbook check,
not application-import completion or a release acceptance result.

Private PR #263 merged to Development at `8e443dece9c0fc3a7ce8ffa26bb5342efd155a42`.
Its tree is identical to tested candidate `c0fe247`: `ced315798e123ac1a9ebf5c83f6b59f9476fc6da`.
Private quality run `34168043562` passed, including independent application
gates, formatting, lint, TypeScript, and private tests. No hosted app was deployed.

The full compiled local run `acceptance-20260907-grouped-final` ended with
86 passes, two failures, and four configured skips. Both failures were the
semester-history test assuming Spring would open first. A read-only check of
the selected fictional database found two current Fall submissions for that
test profile. The existing default-term rule correctly selects a current term
with submissions. The test now explicitly chooses Spring before checking its
activity labels, points, meeting attendance, and switching back to Fall.
Application code and fixture records were not changed for this finding.
The first focused history rerun passed mobile but still lost the initial
desktop semester click. That exposed a separate pre-hydration tab defect.
Two rendered regressions reproduced enabled server-rendered tabs for both
members and officers. A local client-readiness guard now disables those tabs
until their handlers attach. The new browser check deliberately holds scripts,
verifies disabled tabs, then releases scripts and switches semesters.
`acceptance-20260907-profile-hydration` passes desktop and mobile, preserving
the exact historical activity, point, and attendance assertions. Ten focused
profile tests and all 272 private-plugin test files pass. TypeScript and lint
pass. The additional tab fix remains local for grouped integration.

TypeScript, zero-warning lint, formatting, and six bounded route diagnostic
tests passed on the grouped root candidate. The current workbook browser
journey remains missing; the retired uploader and three opt-in screenshot
gallery cases remain skipped. Navigation stream and owned-runner shutdown
diagnostics remain recorded. Hosted performance, official application
reconciliation, the final walkthrough, and Production promotion remain open.

### Full browser search finding, 2026-09-07

`acceptance-20260907-full` ran the compiled app from private `185554d`.
It ended with 83 passing tests, one failing beyond-first-page member search,
four configured skips, and three serial identity cases not run after that
failure. The typed search value disappeared and no search URL was submitted.
The retained screenshot shows the empty input rather than a server-side
zero-result search. This is not full acceptance.

The search control rendered enabled before its React handlers attached. Two
actual server-render tests fail on that markup. A local hydration guard now
disables the input and Search/Clear controls until the client snapshot is ready.
Both server-render regressions and the five existing input interaction tests
pass. Twenty-one directory/filter contracts pass, along with TypeScript, lint,
and the host-import boundary. A new browser case holds JavaScript responses,
checks disabled controls, then releases the scripts and performs the search.
Its first run exposed a test-handler removal race. That test-only race was
corrected. The retained report for
`acceptance-20260907-search-hydration-retest` confirms six expected passes,
zero failures, zero flaky cases, and zero skips. It covers delayed hydration,
typing/button/Enter/clear, beyond-first-page lookup, a corroborated merge, and
refusal of conflicting identity evidence. This closes the reproduced local
search defect, not the remaining full or hosted acceptance gates.

The branch containing `185554d` is pushed to private GitHub, but no pull request
or deployment was created. The hydration fix passed its focused browser checks.
The application layout, header analysis, and per-row targeting tests were rerun:
38 pass with 122 assertions. The linked Google Sheet still needs a fresh live
preview and audited reconciliation after the grouped release. No official
application was imported or approved by these tests.

The complete private-plugin gate passes all 272 discovered test files with
mock-sensitive files isolated. The search fix is saved locally at `c0fe247`,
after application-parser and review-loader commit `185554d`. The root browser
regression and evidence edits remain uncommitted for grouped integration.

### Local follow-up acceptance, 2026-09-07

Fresh isolated project `lets-assist-csf-browser-dv47f3b7a866ebdd` started with
the pinned Supabase CLI 2.111.0. It applied 461 migrations through
`20260907000344`. No old volume, shared local database, or hosted database was
changed. The database workflow checks pass, including anonymous profile-read
refusal and the single-proof and single-credit constraints. Application import,
reviewed profile creation, and scheduling-retirement pgTAP files pass 46
assertions across three files.

The compiled local browser run `acceptance-20260907-followup` passes all 17
selected journeys in 1.4 minutes. It covers application review/import entry,
class-code connection and officer rejection, saved-preview selection through
paging and reload, desktop/mobile semester history, published posts, replies,
member compose denial, and queued-email display. Queue display is not provider
delivery proof. Evidence stays under the ignored
`.artifacts/dvhs-csf-e2e/acceptance-20260907-followup/playwright/` directory.

Server output includes interrupted response streams during navigation and
`kill EPERM` during shutdown. Both app processes were subsequently absent and
ports 3000 and 3001 were free. The exact claim left by owned runner PID 2837 was
released only after an ESRCH check, owner-token validation, and both port probes.
No database files or records were removed. These diagnostics are not a clean
server-log acceptance result and still need explanation. Full browser coverage,
the workbook journey, and the walkthrough video remain open.

Two actual review-loader regressions reproduced an unnecessary serial wait:
application and point rosters did not start until independent review settings
returned. The loader now reads them in the same group after permission and
class/term resolution. Organization filters, explicit profile foreign keys,
missing-class behavior, and proof authorization remain in place. All five
read-scope cases pass. The 19 active-membership cases pass in their own process.
Combining the route-mock and active-membership files in one Bun process produced
three contaminated failures; the required isolated invocation passes without
source changes. TypeScript and zero-warning lint pass. Hosted latency after
this change has not been measured.

The grouped private fixes are saved locally at `185554d` on
`codex/csf-route-performance`; all 271 discovered private test files pass after
the review-loader change. Strict gitlink validation refused the dirty private
feature branch before this commit. Private Development merge and root gitlink
advancement still need to happen in that order. No new PR, push, deployment,
provider send, or Production mutation occurred during these checks.

### Communication review display, 2026-09-07

Five rendered-component regressions reproduced contradictory campaign states.
Cancelled/completed campaigns with resolved receipts retained a historical
review-block timestamp and incorrectly showed an outstanding decision. An
unresolved receipt without that timestamp showed a warning but a normal
delivery label. The local campaign card now uses one display predicate for both:
unresolved receipts always need review; a historical hold remains actionable
only while the campaign is not cancelled or completed. This changes no send
authorization, database receipt, retry behavior, or campaign state.

Six rendered cases and five existing communications contracts pass with 65
assertions. TypeScript, zero-warning lint, and all 271 discovered private-plugin
test files pass. All 304 discovered root unit test files also pass. This remains
a local fix, not a deployed UI change. The full goal still requires grouped hosted
performance/browser acceptance, Production application reconciliation, and
controlled Production email proof.

### Fall application layout verification, 2026-09-07

The newly supplied Fall application export contains 120 populated responses
across 17 columns and 12 blank body rows. Read-only local inspection passed
values in memory to the actual header analyzer and application parser; only
headers, shapes, counts, and fixed field names were emitted. No student values
were saved as fixtures or reports. Deterministic analysis resolves F26 and the
full A1:Q133 range. Each grade resolves its own class: 27 rows for 2027, 33 for
2028, 41 for 2029, and 19 for 2030. All 120 responses retain three claimed point
totals and transcript/receipt file references. File-reference parsing does not
prove access to the attachments.

The check reproduced a course-parsing defect: explicit empty answers became
course names. Eight fictional regressions failed before the fix. The local
parser now omits standalone empty-answer markers after preserving each line's
original index for paired grades. It retains raw response values and leaves
longer course names untouched. In the supplied file, 59 placeholder course
entries are removed. The remaining 463 course entries comprise 372 List I,
41 List II, and 50 List III entries. Sixteen responses now correctly report
missing course data; this does not reject or approve those applications.

The new layout tests cover all 17 columns, both email slots, mixed grades,
source-semester alumni handling, 120 responses plus blank rows, separate totals
and attachments, empty course markers, and paired multiline grades. A parity
test verifies that text-valued Sheet cells parse like numeric workbook cells.
The focused layout, analyzer, and targeting run passes 38 tests with 122 assertions.
The independent normalized-adapter run passes 39 tests with 126 assertions.
TypeScript and the complete zero-warning lint gate pass. The implementation
and tests remain local in the existing private worktree. No build, deployment,
official import, or application decision occurred. The latest saved Production
Fall preview still has 71 rows and does not represent this 120-response export.
After grouped release acceptance, prepare a fresh linked-Sheet preview with
retry lineage and review identity evidence before committing. Never overwrite
the existing immutable preview or describe local parsing as a live import.

### Production workbook reconciliation, 2026-09-07

The signed-in Riddhiman officer session checked all four official class
workbooks through `Check for updates`. Classes 2027 and 2028 returned unchanged.
Their earlier retry queues `923812f5-bcc4-442d-a672-4c1a15fa50e3` and
`14f339c4-6c1b-42d1-baef-532926c61b90` remain completed. No obsolete 2029
failure receipt was retried.

Class of 2029 advanced from provider version 1315 to 1330. Refresh receipt
`7d2858bf-9412-445f-994b-5f4418478a10` completed with two prepared tabs, six
templates, and zero blocked tabs. Class of 2030 advanced from 170 to 174.
Receipt `df57ff91-a131-4cf1-8dd6-58eecf27ef17` completed with eight empty
templates and zero prepared or blocked tabs. No 2030 student records were made.

The two new 2029 previews contain 62 Fall 2025 and 88 Spring 2026 rows. A scoped
comparison against the latest successful source-coordinate receipts found all
150 raw rows unchanged and all 150 target profiles unchanged. The only changed
normalized field was `snapshotHash`. This is a new provider snapshot, not proof
of new student data. The officer's `Approve ready changes` action queued both
previews. Commit queues `6ff78ea0-8255-40ad-9360-45ba5903ce18` and
`16d57268-9b8e-403c-aa76-54f09b7936eb` completed on their first attempt with no
error. The class page shows both terms imported. A subsequent revision check
returned up to date rather than creating another preview.

Before and after this batch, chapter-wide counts were identical:

| Record type              | Before | After |
| ------------------------ | -----: | ----: |
| Profiles                 |  1,047 | 1,047 |
| Activity catalog entries |  1,578 | 1,578 |
| Activity credit records  |  4,434 | 4,434 |
| Meetings                 |     12 |    12 |
| Attendance records       |  1,392 | 1,392 |
| Semester memberships     |  1,913 | 1,913 |

All four workbook registries now contain eight tabs and equal current/prepared
provider versions. This check does not close the separate 2028 account identity
exception or supply a missing officer note for the historical 2027 skip.

Application reconciliation remains open. The canonical Spring preview is
`b7bb0d4f-a7fe-401f-84a4-c697efcb3404` with 517 rows. The Fall preview is
`358ce32d-4442-478c-a15c-95714de23e5d` with 71 rows. Older Spring previews are
retained history, not additional applications. The current two previews contain
585 ambiguous rows, two conflicts, and one resolved row. Production still has
zero imported applications. Source-derived class/term counts are:

| Source semester | 2026 alumni | 2027 | 2028 | 2029 | 2030 |
| --------------- | ----------: | ---: | ---: | ---: | ---: |
| Spring 2026     |          85 |  166 |  176 |   90 |    0 |
| Fall 2026       |           0 |   16 |   17 |   24 |   14 |

The live Production importer ignores the saved Spring preview query parameter
and still renders the 71-row Fall preview. Development already contains the
saved-preview selection fix. Do not generate another Spring snapshot merely
to regain access to its existing decisions. Reopen the saved preview after the
grouped release, review identity evidence, and commit responses separately
from application decisions. No application was matched, created, skipped, or
approved during this check. No build, deployment, migration, email send, worker
flag change, or direct database write was performed. Production data changes
used the application's existing audited refresh and approval actions.

### Development email settlement verified, 2026-09-07

The Riddhiman Chrome profile is accessible again. Officer recovery actions
resolved all ten attempts in campaign `d3352343-d888-42b0-9ba3-f960dd62c688`
as failed, with individual Resend log references proving HTTP 403 sender-domain
refusals. All ten determinations have an actor and retain their original
receipts. No message was resent, no provider ID was invented, and no staff
determination was presented as provider delivery. The officer cancelled the
old campaign through the application; its history and failed attempts remain.

The same audited application flow created, finalized, snapshotted, and queued
campaign `7b81f609-1f8c-42da-8cb1-d4fabd999955` in the fictional Development
delivery tenant. Its ten distinct recipients all match the approved Resend
test-address allowlist. No unrelated active attempt was present.
No-send check `34158729752` passed against exact release `7c24b7a3`.
Single dispatch `34158935320` authenticated, claimed ten attempts, and reported
zero faults. All ten attempts are delivered with distinct provider message IDs;
the database contains ten matching `email.sent` events and ten matching
`email.delivered` events. The campaign is completed, all attempts remain number
one, and there are no unresolved outcomes in this campaign.
All twenty events have verified Svix signatures and recorded verification
timestamps and key IDs. All ten delivered events applied their reduction.
The live officer page shows Completed, ten delivered recipients, and ten
delivered provider attempts.
The synthetic 1440 by 900 screenshot is retained locally at
`.artifacts/csf/development-delivery-completed-20260907.png`. It shows hosted
`7c24b7a3`, not the uncommitted follow-up, and contains no recipient addresses.

Audited runtime transitions used request IDs ending `139101` through `139106`
under UUID prefix `7a2d9d10-87b6-4c6e-8d19-1a5fbb`. The final revision is 6
with workbook, import, communications, and legacy scheduled publishing disabled.
This proof reused the existing deployment. No Vercel build or Production change
was made. Production email proof, officer-route performance, official imports,
the workbook browser journey, and final media acceptance remain open.

The old cancelled campaign still displays a review-blocked notice after all
ten reviews resolved. Treat that display as a remaining UI finding, not an
unresolved provider outcome or a reason to retry delivery.

### Short route diagnosis and local Classes fix, 2026-09-07

`scripts/hosted-development/diagnose-csf-routes.mjs` targets only the existing
fictional hosted load tenant on Development. It verifies the served release
before minting a session for one existing fictional officer, checks trusted
fixture metadata, sends no login email, and revokes its own session afterward.
Credentials and response bodies remain in memory. The output contains fixed
route labels, response timings, and verdicts, not roster or cookie contents.
Two warmups precede ten measured reads per route, with concurrency limited to
one, five, or ten. This is a short diagnostic, not 100-session acceptance.

At unchanged hosted `7c24b7a3`, one-request concurrency passed with Classes p95
1,587.051 ms and Applications p95 1,604.530 ms. The first cold Classes request
took 4,532.252 ms. The first five-request burst failed: Classes p95 4,313.508 ms
and Applications p95 4,659.747 ms. A second five-request burst passed at
2,090.478 ms and 1,728.116 ms respectively. Retain both burst results; the
variation does not close the original 100-session failure.

Read-only Development database statistics identified
`csf_term_closure_readiness` at about 1,094 ms mean execution time. The Classes
caller still computed this Terms-only preflight. A regression executing the
actual caller block failed before the fix and passed after restricting that
read to Terms. The authorized Terms preflight, evidence hash, closed-term
refusal, and permission checks remain unchanged. No database migration is
required for this caller fix. Nineteen focused private tests, six diagnostic
tests, scoped zero-warning ESLint, and root TypeScript pass locally.

The private changes remain uncommitted on `codex/csf-route-performance` in the
existing isolated worktree. The root gitlink and deployed code remain unchanged.
Applications diagnosis and full hosted post-fix acceptance remain open. No
build, push, or deployment ran for this diagnosis.

### Development follow-up deployed, 2026-09-07

Private PR #262 merged after its checks passed. Root PR #490 merged only after
CI `34093192415` passed on `48eb2774bbfa13b3957e37fdc33700c55c859066`.
Development merge `7c24b7a3733e95ca9a93ed1a0f731353625a7f75` has the identical
tree `c05ffdd4b47360d1518cc9f4bf0dc127cd948b01` and private gitlink
`70f28012d98a0fadf0b14b7380ba04b79e93dfbd`. Its single approved Vercel build,
`dpl_APFJTbzeCNo9vbSMM7KgMH6CPznc`, is READY and assigned to
`dev.lets-assist.com`. Both feature-branch builds were skipped.

CI discovered 303 root and 297 private-plugin test files. TypeScript,
zero-warning lint, the build, 7,120 database assertions across 244 files,
scale checks, three DV browser tests, and 87 CSF browser tests passed. Three
optional screenshot galleries and one unconditionally disabled historical import
journey were skipped. The latter is an open workbook-UI acceptance gap, not an
opt-in success. Fictional desktop and mobile profile screenshots
are retained in the ignored artifact from run `34093192415`. The frontend
inspection confirmed semester-specific profile totals and participation labels;
this does not prove official Production data reconciliation.

No-send check `34095049908` verified the exact Development release and returned
authenticated, disabled, zero claimed, zero faults. Release controls default to
revision 0 with every worker disabled. Hosted performance acceptance
`34094827987` failed its per-route latency gate. It completed 9,520 requests
from 100 distinct sessions with zero request errors, zero 5xx, and zero browser
errors or crashes. Member routes and Officer Home passed. Officer Classes p95
was 5.355 seconds and p99 was 6.225 seconds; Applications p95 was 2.776 seconds.
Mutation p95 was 2.323 seconds, LCP p75 was 2.328 seconds, INP p75 was 16 ms,
and CLS p75 was 0.00210. All 25 review navigations finished; retained heap fell
23.25 percent. The previous read reductions did not establish the required
officer-route improvement. Keep both runs and profile the complete request
before another deployment. The existing ten refused attempts remain
`unknown_outcome`, with zero provider message IDs. No attempt was resent and no
staff determination was substituted for a signed provider event.

Read-only Production checks found one matching chapter, four workbooks, 4,434
activity entries, 1,392 attendance records, zero applications, and zero campaigns.
Its ledger remains at 460 migrations without the scheduling-retirement migration.
The previous release's workbook and import controls remain enabled;
communications and scheduled publication remain disabled. A fresh unauthenticated
public status probe and the authenticated Vercel fetch hit the security
checkpoint, so neither establishes the currently served public SHA. No
Production state changed. The Mac is locked; unlock was requested once.

This entry is a local continuation record until the remaining acceptance results
can be grouped into the final release evidence. Do not trigger another build for
this documentation update.

### Approved Development sender correction, 2026-09-07

Root PR #490 initially failed its release-documentation check because the officer
runbook still named the preceding private gitlink. The candidate now updates
that reference to `70f2801`; no application behavior changed. Run `34092764837`
retains the failure. Remaining jobs were cancelled before updating the same PR.

Private PR #262 passed both checks before merge. Private Development now pins
`70f28012d98a0fadf0b14b7380ba04b79e93dfbd`, containing the officer read-scope
fixes in `38ce211de723c53b627cf171cb074c685f02bba5`. Root unit tests recorded
1,305 passes and one expected gitlink mismatch before integration. After the
root pointer update, the strict submodule check and all 18 audit-inventory and
hosted-metrics regression tests pass. No code change hid the original failure.
The grouped root follow-up still needs CI and hosted Development acceptance.

The user approved the Development sender/key correction and one grouped
follow-up build. A separate Resend `sending_access` key now matches the
configured `notifications.lets-assist.com` sender domain. Its identifier is
`583f0be8-afe9-4629-836c-ca7678e64b6b`. The token passed in memory from the
provider CLI to Vercel stdin and was not printed or saved locally. Vercel
stored it as sensitive `RESEND_API_KEY`, Preview target, Git branch
`development`, project `prj_XUDpEktrouxF4dc2VGMegoL00dlE`. Production credentials
and existing keys were not changed. The test-recipient guard remains active.
The ten prior unknown-outcome receipts were not modified or resent. Effective
runtime use and fresh signed email settlement remain unverified until release.

### Grouped Development follow-up, 2026-09-06

Hosted run `34085356037` finished at 2026-09-07 05:40 UTC with GitHub status
success. Its 100 distinct sessions made 9,418 read requests with zero errors.
Pooled read p95 was 1.913 seconds and mutation p95 was 2.354 seconds. Browser
LCP p75 was 2.216 seconds, INP p75 was 32 ms, and CLS p75 was 0.00210.
All 25 review navigations finished without crashes or browser errors. Retained
heap fell 11.0 percent from the measured baseline.

This status does not establish the requested per-route performance acceptance.
Officer Classes p95 was 3.835 seconds and Applications p95 was 2.566 seconds,
above the 2.5-second budget. The old gate evaluated only pooled read latency.
A local regression now requires every expected member/officer route to meet
the p95 and p99 budgets, rejecting absent, duplicate, or invalid measurements.
The focused suites pass 12 tests; targeted lint passes. No push, build, new
load run, credential change, or Production promotion followed this audit.

Update at 2026-09-07 05:35 UTC: CI `34085169784` passed, including 303 root
and 296 private-plugin test files, 244 pgTAP files with 7,120 assertions,
87 CSF browser tests, three DV browser tests, TypeScript, zero-warning lint,
and the Production build. Hosted acceptance `34085356037` remains running.
No further build or Production change has been started.

The single Development dispatch `34086512406` authenticated and claimed the
ten approved fictional attempts with zero worker faults. This is not provider
acceptance. All ten Resend requests returned HTTP 403 because the Development
send key cannot send from the configured `notifications.lets-assist.com`
domain. Provider logs confirm the same explicit refusal for all ten requests.
The database retains ten `unknown_outcome` receipts, no provider message IDs,
and no verified settlement. The provider omitted its expected error name, so
the application retained the conservative unknown classification.

The communications control was disabled after this result. Runtime revision 6
for `db4ae4194141ca15571361ccddc437f163aa9c4e` has every worker disabled,
confirmed through a read-only query. Disable receipt:
`164c1f8d-fc0d-4e22-95af-541048515bfd`. Earlier staged activation checks found
no pending workbook or import jobs, and those workers were disabled before
the one email dispatch. No attempt has been resent or rewritten, and no
student received a test message. The browser recovery queue exposes audited
staff determinations separately from provider evidence. No determination was
submitted during inspection.

The Development sender/key scope mismatch remains an acceptance blocker.
Correcting it must preserve environment separation and frozen campaign content.
The approved credential rotation and additional Development build are complete;
another credential change or deployment requires separate approval. Do not
change the frozen sender or retry these receipts to manufacture settlement.

Root PR #489 merged to Development at
`db4ae4194141ca15571361ccddc437f163aa9c4e`, tree
`b9fbfd17b65e31b601821ca27e3275e5329916dc`, with private gitlink
`f1a730d91ea98ca7e17609a73e1081bcdb64c089`. This matches the candidate tree
at `e85a3415`. The `gh pr merge --auto` invocation merged immediately while
CI was pending because the branch did not require those checks. This ordering
was an operator error, not passed acceptance. Production remains unchanged.

The single approved additional Development build is READY as
`dpl_86RskwCEHmoGa6Kkmsr1TjRYfeft`. Hosted run `34085356037` verified the
exact Development domain SHA and Supabase binding before starting its load
test. PR CI `34085169784` passed the quality job, including tests and the
Production build. Its database/browser job and hosted performance acceptance
were still running at this checkpoint. Neither a merge nor READY closes them.

Development credential check `34085524692` passed against the new deployment:
authenticated, communications disabled, zero claimed attempts, zero faults.
The Production workflow job did not run. A fresh Riddhiman Chrome tab opened
the fictional delivery tenant. Its existing campaign was queued through the
application confirmation dialog. The rendered result and database agree on
ten queued recipients and ten queued attempts. No provider send has run.
The refreshed queue audit found no pending workbook or import work; existing
blocked items remain blocked. All runtime controls remain false. The isolated
email test must retain the staged activation checks and independent rollback.

### Approved Development credential rotation, 2026-09-06

The user approved rotating the Development communications worker credential and
one additional grouped Development deployment. The replacement is stored as
`CSF_COMMUNICATIONS_WORKER_SECRET_TOKEN` in GitHub's `development` environment
and as a sensitive Vercel Preview variable scoped to the `development` branch
of project `prj_XUDpEktrouxF4dc2VGMegoL00dlE`. Both provider commands succeeded.
The credential was generated in memory and passed through stdin. No plaintext
value was printed or written to a local file. Production credentials were not
changed. Authentication with the replacement remains unproven until deployment.

Private PR #261 groups the point-lock refusal and saved-preview selection fixes.
Its first CI run failed the source-size check because the dashboard loader had
807 lines. Shortening its comments brought it to 798 lines without changing
behavior. The private source-organization check passes locally. Root load
diagnostic tests pass 10 tests and 220 assertions. No additional Vercel build,
campaign queue operation, or email send has occurred at this checkpoint.

Private PR #261 subsequently passed CI `34084488326` and merged into private
Development at `f1a730d91ea98ca7e17609a73e1081bcdb64c089`. The root candidate
uses that merged gitlink. Full local TypeScript and zero-warning lint pass.
Hosted acceptance and the replacement credential's runtime check remain open.

The manual communications workflow now has an explicit Development path using
the Development secret. Its script verifies the deployed SHA and disabled
runtime controls before an authentication check. Dispatch mode requires a
separate confirmation, only one queued fictional campaign, the exact ten test
addresses, and ten untouched first attempts. It refuses other active queues,
prior attempts, Production endpoints, redirects, and automatic retries. It
never queues a campaign or changes worker flags. The Production job is confined
to `main`. Local delivery and documentation checks pass; no live invocation has
occurred. The local root test rerun found the officer runbook's old private
gitlink. That ledger text is corrected to `f1a730d`; its focused contract passes.

### Completed-preview identity review, 2026-09-06

Root PR #486 merged at `60825d2d`. CI `34021317555` passed on that merged
commit, and hosted acceptance `34021315408` passed with 100 distinct sessions,
9,650 requests, zero request errors, read p95 1.94 seconds, mutation p95 1.91
seconds, no renderer crashes, and retained heap growth of -12.21 percent.
Development deployment `dpl_9zJKKuLcQrQyW5riTbZPgfYdXVFW` serves that commit.
Private PR #258 promoted the same plugin tree to private main at `ab585e5`.
The merged remote feature branch was removed; its commits remain in Development.

The unresolved review on Production PR #483 exposed a separate identity guard
gap. An isolated regression reproduced six failures: pending, running, failed,
and cancelled previews accepted matches and changed rows and audit history.
Forward migration `20260906085350` locks the preview before the row and rejects
non-preview or unfinished jobs. Its final full replay passes 460 migrations
and 7,159 assertions, including skip and cancelled-replay regressions. The exact
release catalog passes; all ten trigger and permission drift checks refuse
the change and roll back. Production promotion
remains paused for this fix. No official records or Production schema changed.

The count-only club-reference audit found nine filenames identifying Fall 2025
or semester one of academic 2025-2026, despite the folder's Fall 26 label.
The other twelve remain unassigned. A bounded first-sheet scan found no
explicit semester labels. No reference or point record was assigned from the
folder name alone. The Production application importer shows Connected in a
fresh Riddhiman Chrome tab; the old tab's stalled status is not a completed
import or a proved application defect.

### Inline point approval, 2026-09-06

PR #485 merged at `40733af1` after CI `34014450823` passed. The exact
Development deployment is `dpl_HPfUEFWPfMiTntgWZ56btc35vsG6`. Hosted acceptance
`34015143496` passed. The preceding accepted tree `e6922a7f` passed
`34013573108` with 100 distinct sessions, 9,523 requests, zero errors, read
p95 1.69 seconds, mutation p95 1.83 seconds, and 25 crash-free review
navigations. Those results do not cover the following new fix.

A fictional officer recording proved application approval survives reload.
The point review path then failed with `Invalid input`: its inline buttons
omitted the required `requestId`. The standalone review dialog already
included that field. A local patch now creates stable per-decision IDs,
prevents concurrent duplicate clicks, preserves server receipt outcomes, and
locks the queue on an unconfirmed response. Five focused tests pass.

The current-semester browser test then found a separate database defect:
`csf_enforce_point_submission_freeze` blocked officer decisions when point
verification was open. Forward migration `20260906062954` permits only
decision-field changes by a revalidated officer and retains the student claim
freeze. It also blocks changing a frozen student row's source to evade the
freeze. The review-period suite passes all 46 assertions.

The fictional 1440-by-900 browser run passes application approval and point
approval, including reload persistence and point status/reviewer/timestamp
readback. These local results cover the uncommitted UI and migration fixes,
not hosted acceptance or Production. The owned stack was removed after the
run. The full isolated replay passes 458 migrations, 244 test files, 7,143
assertions, and the exact accepted release catalog. Private PR #257 passed CI
`34016828013` and merged to private Development at `e03130c`. Root integration
and exact-tree hosted acceptance remain open. All 266 private-plugin test
files, TypeScript, and zero-warning lint pass.
No official rows changed and no new Vercel build was requested.

Root PR #486 contains the point-review fixes. CI `34017021587` passed lint,
TypeScript, database workflows, and scale checks, but its root test gate found
one stale catalog assertion: the new trigger raises the definition count from
nine to ten. The follow-up fixes that assertion and tests the trigger's exact
definition and internal execution permissions. The previous 457-migration
catalog must still contain only nine definitions. All 41 focused release
tests, all 301 root test files, and the strict private gitlink check pass.
Browser CI remains in progress.

The Production audit found all four class workbooks linked with eight tabs
each. Drive metadata confirms access to all four files and chapter ownership.
Those checks do not establish completed imports. Class of 2030 remains linked
with eight unsynced template tabs. Vercel Billing shows Speed Insights Plus
disabled. Production remains at 451 migrations with all three recorded worker
controls disabled. No provider settings or official records changed in this
check.

### Installed point-freeze trigger verification, 2026-09-06

CI `34017876391` passed for `91312881`, including the production build and
database/browser job. Final review then found that the release catalog checked
the repaired function but not its installed trigger. The follow-up verifies
the trigger's relation, name, function, enabled state, row/event type, and
absence of arguments, column restrictions, or a conditional predicate.

The new unit regression failed before the fix. All 42 focused release tests,
all 301 root test files, zero-warning lint, and the strict private gitlink check
now pass. An owned isolated replay passed 458 migrations and 7,143 assertions.
The actual release query rejected eight trigger changes: removal, disabling,
replica-only execution, rename, reduced events, statement-level execution, a
false predicate, and a different function. Each change rolled back, and the
unchanged catalog passed again. The owned replay stack was removed. No
Production trigger or migration changed. Root PR #486 remains open for this
release-verifier follow-up; its application and private-plugin bytes did not
change.

Branch cleanup removed 15 local and 15 remote merged branch names after
ancestry checks against each repository's Development branch. All commits
remain recoverable from that history. Active worktrees and their untracked
files were preserved. Stale remote-tracking refs were pruned.

The count-only Production audit found 4,427 imported activity events and
matching credit records with no missing links or inconsistent identity/term
scope. All points are positive, and no verified participation group repeats.
All 1,392 attendance records have labels and both legacy and canonical meeting
links in the correct semester. These checks do not establish source-by-source
equality, completed pending imports, or member-browser acceptance.

### Point update permissions and token rotation, 2026-09-06

CI `34019865179` passed quality on `24fb77aa`. Its database job first stopped
before startup because a runner port was occupied. Retrying only that job on
the unchanged commit passed startup and database tests, then reproduced a
fixture seeder defect: point fixture `upsert` required the removed runtime
UPDATE permission. The seeder already awaits an organization-scoped delete of
those fictional rows. It now uses INSERT rather than restoring the grant.
The new regression failed before the change and all 31 seed tests pass after
it. A fresh isolated seed and reseed each produce the same four point rows
under the restricted server role. All 44 seed and documentation tests and
focused zero-warning lint pass. The owned stack was removed after Docker
confirmed no remaining containers, volume, or network for its project. This
seeder-only follow-up still needs CI; no application or migration bytes changed.

The Production communication audit found no CSF dispatch attempts, delivery
rows, or recorded CSF provider events. The generic signed webhook replay is
not evidence of a CSF queue-to-provider dispatch. The controlled email test
remains open.

Count-only application inspection found complete class/term targets for all
517 Spring 2026 and 71 Fall 2026 preview rows. Spring has 430 unique exact
class-name candidates, 86 without an exact candidate, and one duplicate
candidate. Of the 86, 85 belong to Class of 2026, outside the four linked
workbooks. Fall has 38 unique candidates and 33 without an exact candidate,
including all 14 Class of 2030 applicants. These are review categories, not
identity proof or committed records. No official row changed.

Review of PR #486 found that direct `service_role` updates could supply an
officer ID and bypass the canonical approval receipt. The application uses
RPCs for these updates. Forward migration `20260906073357` removes direct
runtime UPDATE permission while retaining reads and existing audited actions.
The release catalog checks table and column permissions. Regression tests
exercise a refused direct update and approval/retry under the server role.
The isolated replay passes all 459 migrations and 7,145 assertions across 244
files. The real catalog refuses ten trigger or permission changes and passes
again after each transaction rollback. Canonical approval and exact retry
pass under `service_role`; the direct update is refused. Zero-warning lint,
37 focused release tests, TypeScript, and the strict private gitlink check pass.
The root sweep found only a stale runbook ledger count. After correcting it,
all 13 documentation assertions and the full 301-file root sweep pass.
CI `34018967853` passed for the preceding trigger check, including its browser
job, without a restart. The permission follow-up still needs CI and hosted
acceptance. Production remains at 451 migrations, with direct
point UPDATE permission still present and all worker controls disabled. No
Production schema or official records changed.

EXT-007 is resolved. Vercel now holds separate Development and Production
replacement bypass tokens. GitHub environment secrets and both enabled Resend
webhook URLs use those replacements. Readback preserved the webhook IDs,
subscriptions, status, and signing configuration. Replayed signed delivery
events returned HTTP 200 at `2026-09-06T07:32:59.904Z` in Development and
`2026-09-06T07:33:00.576Z` in Production. The old token was revoked after those
checks. No email was sent and no deployment was created. These replays do not
replace the controlled ten-message queue-to-provider acceptance test.

### Frozen annotation review guards, 2026-09-06

Root PR #484 merged to Development at `e6922a7f`, with the same application
tree as tested `a51e31bf`. CI `34012777423` passed, including 7,129 database
assertions across 244 files and 85 CSF browser tests with four skips. Hosted
acceptance `34013573108` remains in progress at this check. Production PR #483
remains open and Production has not advanced.

Two further review findings reproduced nine failures in a 47-assertion local
test. A frozen row could accept a new annotation decision after its worker
stopped without beginning a row attempt. Pending, running, failed, and
cancelled previews could also accept decisions. Forward migration
`20260906053114` guards both cases. The focused database test passes all 47
assertions after applying the fix. The 21 release-contract tests, TypeScript,
and zero-warning lint pass. A fresh isolated replay applied all 457 migrations
and passed 7,139 assertions across 244 files in 19 seconds. The exact release
catalog returned `1`, and error-level advisors found no issues. All 19 release
documentation contracts pass. These local results do not establish hosted or
Production acceptance.

The previous owned regression stack was removed after validating its resource
ownership. It contained fictional test data. No hosted or shared-local
database was changed. Chrome remains unavailable while the Mac is locked.

### My CSF selected semester, 2026-09-06

Private PR #255 merged to Development at `0ca0d7a`. Private quality run
`34011594879` passed for the identical source tree at `f73fd1b`. The root
candidate now pins the merged commit. My CSF shares one semester selection
between its profile summary and history. Opening a recorded semester shows
that semester's points, activities, meetings, and officer status. Selecting an
empty current semester still shows its actual zero counts.

Integrated TypeScript, zero-warning lint, and the strict gitlink check pass.
The desktop and mobile browser regression passes, including switching from
recorded Spring 2026 to empty Fall 2026 and back, activity and meeting labels,
zero browser failures, and no horizontal overflow. The compiled local run
produced fictional screenshots and videos. Its first
run reached the correct Spring 2026 summary but failed because one activity
label appeared in both participation and point submissions. The test now
selects the participation occurrence. The following attempt stopped before
the app started because the first runner left a port reservation after a
shutdown error. Its recorded owner process was absent and port 3002 was free.
That reservation was moved aside without deleting it. Port 3000 and shared
services were not changed. The rerun passed both tests in 49 seconds. Hosted
acceptance and Production remain open.

### Combined import review regression, 2026-09-06

PR #484 review found that the original two-order fixture used `pending` rows,
but real annotation blockers use `error`. Updating the fixture reproduced five
failures against migration 455. Forward migration `20260906044753` admits
annotation-only errors to identity review and preserves those errors until
the separate annotation decision. It also supports confirmation retries in
that state. Mixed unrelated errors stay blocked. All 37 focused assertions
pass after the change. The previous migration remains unchanged. A fresh
isolated database applied all 456 migrations, and the exact read-only release
catalog returned `1`. Error-level advisors reported no issues. The complete
pgTAP command did not pass: two files exited before emitting a plan, and a
targeted retry reported a local connection timeout. The full run reported
6,978 assertions across 243 files. Do not treat this as a complete replay gate.
The existing isolated stack remains the retry target.

The scripts guide no longer calls file-only `db:validate` a replay check.
A regression enforces that distinction. The officer runbook now records the
current ledger and private gitlink. Twenty-five release and file-validation
tests, TypeScript, and zero-warning lint pass for this follow-up.

CI run `34011927835` completed with a stale runbook-ledger test failure and
one outdated applicant browser assertion. The browser suite passed 84 tests,
including the new desktop and mobile My CSF checks, and skipped four. Its
fictional applicant output shows Spring 2026 and "Under officer review" in
both summary and history. The test now checks that shared state, then selects
Fall 2026 to check "No semester record". Role-access checks remain unchanged.
The corrected browser test and follow-up migration still need passing CI and
hosted acceptance. No Production data changed during these fixes.

Local tooling incident: running `bun run db:validate` reached its implicit
`supabase db reset --local --yes` before it was interrupted. The shared
`supabase_db_lets-assist` container and volume were absent afterward, while
other shared services remained. Previous local contents and recoverability
are unverified. No hosted database was targeted. The owned isolated regression
stack remained healthy. Do not call this an isolated replay or a passing
validation run. The command now performs file checks only. Three hermetic
tests prove it cannot invoke Bun, Supabase, or Docker and still rejects invalid
names and duplicate versions. Use the separate owned isolated replay gate for
database proof. Shared-local recovery remains open; no restore was attempted.

Production PR #483 remains open. Review found that annotation settlement and
identity reconciliation shared a terminal resolution field. A synthetic pgTAP
regression reproduced five failures: annotation-first prevented matching, and
identity-first prevented annotation review. The failure also lost the chance
to retain both audit decisions.

Forward migration `20260906041507_csf_composable_import_reviews.sql` keeps the
decisions independent without changing historical migrations or source data.
Matching retains a reviewed annotation outcome. Annotation review accepts a
matched row and preserves its profile and match metadata. An unresolved
identity remains a readiness blocker after annotation review, including a
valid source key with conflicting contact evidence. Repeated annotation
decisions remain blocked, and the existing request receipt still handles a
lost response.

Local evidence: the focused database tests passed 71 assertions. The full
fresh replay applied all 455 migrations and passed 244 files with 7,125
assertions. Error-level Supabase advisors found no issues. TypeScript,
zero-warning lint, and the strict private gitlink check passed. The exact
release catalog returned `csf_target_schema_verified=1` in a
read-only transaction against that stack. Twenty-one release-controller tests
passed, including old ledger compatibility and rejection of changed migration
bytes. The three file-validation tests also passed. The new migration has not
been applied to either hosted environment.

Hosted Development run `34009457889` passed for root `6f413621` and private
gitlink `c822293`: 100 distinct sessions, 9,614 requests, zero request errors,
read p95 1.68 seconds, mutation p95 1.82 seconds, 25 review navigations without
a crash, and retained heap down 11.67 percent. This proves the previous candidate, not the new combined
review fix. Production remains at root `00ba3b1e`; no new app build, import
commit, email send, or Production schema change occurred during this fix.

### Domain assignment projection

Configuration release `33950191490` failed its read-only alias check before
creating any build or moving the domain. The Vercel domain API maps `lets-assist.com` to READY
Production deployment `dpl_858adwbvCDtPEUq2gdhopRMTH1GJ`, with alias assignment
complete, but the deployment response's alias list omits the public
domain. The verifier now uses the exact unique domain assignment and still
requires the matching deployment ID, project, Production target, READY state,
and completed assignment. It no longer treats that list as a second
authority. Focused tests cover omitted and stale deployment alias lists while
retaining wrong-domain and unfinished-deployment rejection.
The verifier also rereads the authoritative domain assignment after validating
the deployment. A regression reproduced an incorrect success when the domain
moved between those reads; the final recheck now refuses that race.
Twenty-six focused tests, TypeScript, and zero-warning lint passed for the race
fix. Test formatting also passed.

The full CI run `33950851495` passed on `b2957a94`, including the Production
build and database/browser gates. A later review found that an inconclusive
final domain read should retry within the existing deadline rather than fail
immediately. Network-error and malformed-response regressions reproduced the
failure and now pass. Confirmed domain mismatches still fail immediately.
The follow-up passes 27 focused tests, TypeScript, and zero-warning lint.

The Production Class of 2030 workbook link now persists through the audited
Settings action. A read-only database check confirms the intended source and
owner, with one refresh job queued. Discovered tabs remain zero in the registry
until the disabled refresh worker runs. No profiles or participation were
created by linking the empty workbook.

### App-only release and alias reconciliation

Review follow-up rechecks the project operation after each alias observation,
including the final one, so a concurrent promotion prevents absent-record
settlement. Recovery now consumes the explicit alias-settled result and fences
initial missing metadata against the exact maintenance or application alias.
Thirty-three focused tests passed, including execution of the recovery helper
with missing, pending, and changed operation records. No recovery was dispatched.

Workbook-worker activation run `33948456893` stopped before preparing a receipt
or mutating controls. The Management read-only role cannot execute the runtime
reader RPC, but has schema and table read privileges. The controller now reads
the same release-scoped controls directly through the read-only endpoint. It
keeps the RPC's missing-release defaults without expanding any grants. Nine
focused transition tests pass, including one-write receipts, lost-response
reconciliation, and the read-only query contract. All Production workers remain
off at revision zero. Do not retry the failed run.

The count-only encryption audit found 15 access tokens and 15 refresh tokens
still needing rotation, with zero live OAuth attempts needing the retained key.
Keep the legacy key until successful credential reads migrate those connections
and all retirement counts reach zero.

Controller PR #473 merged at `0157de6145b39d3404f275c857529c5ab9674af1` after
CI `33946585521` passed. App-only run `33947492691` built the accepted app once
as `dpl_858adwbvCDtPEUq2gdhopRMTH1GJ`. Staged smoke checks passed and Vercel
promoted it. The public verification and rollback guard then both stopped
because the project API returned `lastAliasRequest: null`; rollback did not run.

Read-only reconciliation confirmed `lets-assist.com` points to that READY
deployment. Public smoke checks passed on exact SHA
`dfe7fa586a8c55789cab194d4c7f2fab9cd254c2`, with the Production backend, login,
protected CSF redirect, and all four workers disabled. Previous deployment
`dpl_HtRch4K8gor7owGrZva4fiEunkLg` remains the app rollback target. Do not rerun
the failed release or rebuild this artifact. The workflow remains failed;
manual alias and runtime evidence establish the current app state, not full
officer workflow or import completion.

The alias-operation verifier now accepts absent operation metadata only after
two observations of the exact READY Production alias. It still rejects a wrong
project, wrong alias, unfinished deployment, or a new pending operation. This
matches the Vercel CLI's absent-record behavior while retaining independent
deployment checks. This controller change requires no application deployment.

### Forward-migration controller follow-up

Hosted acceptance `33941425951` passed on `cd7a806f`: 100 sessions, 9,584
requests, zero errors, read p95 1,694.8 ms, mutation p95 1,867.4 ms, LCP p75
1,700 ms, 25 review navigations without errors, and retained heap down 11.4%.
PR #471 merged at `dfe7fa58` with the same accepted tree. PR #472 merged the
controller at `7d5d1d1b` after CI `33942643526` passed.

Forward-migration run `33943395092` stopped at its initial ledger check and made
no write. A fresh Production read found both target migrations already present,
with stored statement digests and eight function definitions/ACLs identical to
accepted Development. No migration retry is needed. Worker controls remain off.
The old catalog verifier still looked for two email-only fragments in the new
provenance wrapper. The controller now checks those fragments in the renamed
legacy helper and checks the exact accepted definitions and grants of all eight
upgraded functions. Read-only verification passes in both hosted environments.
Twenty-six focused tests pass. This is controller-only code; keep application
release `dfe7fa58` and accepted SHA `cd7a806f` without another app acceptance build.

PR #473 review follow-up adds the provenance trigger attachment, enabled state,
event, target function, and unfiltered row checks. Missing or repeated final
gate anchors now throw instead of leaving an unused validation CTE. Regression
tests first failed on both defects and now pass. All 23 app-release tests,
TypeScript, zero-warning lint, and diff checks pass. Production and Development
read-only catalog queries pass. Development queries requiring a missing or
disabled trigger fail closed without changing any database object. Prior CI
`33943815529` passed before this follow-up; the updated controller needs CI.

The final ledger review also pins the complete 446-version sequence by count
and SHA-256. A regression test first reproduced acceptance of an inserted
backdated version, then passed after the fix. It also covers omitted, replaced,
and reordered versions with the same maximum version. All 24 app-release tests
pass. This remains a controller-only update in PR #473.

The grouped final schema review pins the accepted legacy ledger before taking
the fallback path. It checks the provenance column type, default, NOT NULL,
and validated accepted-value constraint. Worker table fingerprints now cover
owner, RLS, ACLs, columns, defaults, constraints, indexes, receipt trigger, and
policies; effective runtime table and column privileges must also be denied.
Both hosted catalogs pass the complete read-only query. Six Development-only
negative queries reject wrong defaults, nullable provenance, invalidated
constraints, changed worker ACLs, runtime privileges, and disabled receipt
triggers. These tests changed query expectations, not database objects.

The durability review also requires permanent logged worker tables. An unlogged
relation no longer enters the accepted two-table posture. The profile provenance
column must remain ordinary and writable, not generated or identity-backed.

Function ACL verification also rejects grant options and any grantor other than
the accepted postgres owner. Runtime execution grants cannot delegate access.

The replacement Production Resend webhook is disabled and its signing key is
saved as a Sensitive Production keyring. No email was sent. The exposed project
automation bypass was rotated, its three GitHub and three webhook consumers
updated, and its old value revoked. Development status returned HTTP 200 with
the replacement. No build was needed for that rotation.

- PR #470 is merged to Development at `cd7a806f1a30161291da7254210e7d90ddc60ded`.
  Its Vercel deployment is READY. Production PR #471 passed CI run
  `33941557762`. Hosted acceptance run `33941425951` remains in progress.
- Production still has 444 migrations through `20260903050000`. The next two
  migrations have passed the full CI replay but have not run in Production.
- The old schema workflow requires external-drive recovery inputs that the
  user excluded. A separate controller now pins the two approved SQL hashes,
  checks the exact 444-version prefix, and records both forward migrations in
  one transaction. It uses the existing management credential and retains the
  Production environment review. No export, restore, app deployment, import,
  or worker activation runs in this workflow.
- Nine focused controller tests pass, including lost-response settlement,
  refusal without retry, byte drift, ledger drift, project isolation, and ACL
  verification. Zero-warning lint passes. Publication and real migration
  execution remain pending. This is controller work, not another app candidate.

- Private PR #244 is merged at `31e6bb19`. Private `main` and `development`
  point to that commit. The user-authorized change removed only the private
  `main` last-push approval requirement. Security checks, force-push refusal,
  and deletion protection remain enabled.
- Root PR #470 at `3514ef29` passed CI run `33932222279`, including quality,
  Production build, database replay, and browser workflows. The newer local
  worker-control edits below have not passed that CI run or hosted acceptance.
- App-only run `33933383403` verified the accepted source and Production schema,
  then created `dpl_C4c8YQXnCS9KDKhvxiAbwyoy2jLD`. Vercel canceled it in the
  ignored build step before dependency installation or the app build. The
  top-level deployment `ignoreCommand` did not override the source policy.
  No public promotion, database mutation, worker activation, or import occurred.
  Do not rerun that same request or treat it as a successful deployment.
- The follow-up candidate now has a tested, per-deployment exact-SHA Production
  build-policy override. Automatic `main` and feature-branch builds remain off.
  This rule requires the new application source, so the old accepted source
  cannot use it. Group it with the follow-up release before hosted acceptance.
- Forward migration `20260905003409` and the server worker reader are local
  work in progress. All 18 focused pgTAP checks passed in an ephemeral,
  network-isolated Postgres container. Six reader tests, 13 import-worker route
  tests, 16 build-policy/staging tests, TypeScript, and zero-warning focused
  ESLint passed. The temporary container was stopped and removed. The shared
  local stack and hosted databases were not changed.
- The local runtime transition workflow now makes no Vercel writes or builds.
  Seven behavioral tests cover configuration, one-write settlement, lost-response
  receipt recovery, mismatched receipts, public-state refusal, unsettled
  postconditions, and independent disable. The staging request selects database
  mode. The complete local isolated gate passed 446 migrations, 7,032 pgTAP
  assertions, CSF workflows, architecture and plugin-isolation checks, strict
  gitlink validation, TypeScript, zero-warning lint, browser isolation, and cron
  probes. It removed its owned stack. The full suite passed 296 root and 287
  private-plugin test files. Exact CI and hosted acceptance remain open.

## Class Sheet import reliability repair, 2026-08-24

- The 2026-08-25 continuation expands the reviewed Development policy from a
  single Spring 2026 tab to every populated canonical semester tab in the
  approved Class of 2027–2029 workbooks. Class of 2030 remains template-only.
  Discovery now recognizes the legacy `Acitivty` typo, carries a stable mapping
  for the damaged legacy last-name header, and refuses populated tabs whose
  class semester is not configured instead of silently omitting them.
- Repeated plain activity labels count one point per occupied numbered slot for
  each student. One explicit quantity for the same normalized activity is
  authoritative, repeated copies do not multiply it, and conflicting,
  non-positive, malformed, or over-100 quantities block preview readiness.
  New class-history previews retain only approved activity and meeting cells,
  their source coordinates, the saved point mode, and a database-derived
  evidence digest. Meeting labels now agree across the TypeScript and database
  canonical contracts and survive into the commit payload.
- Replacing a linked class workbook now reconfigures each existing
  class-and-semester source instead of colliding with its unique title. A
  database trigger clears preview, commit, status, and error state when the
  source file identity changes, so the new workbook cannot display the old
  workbook's sync evidence.
- A committed needs-resolution preview no longer suppresses the next provider
  acquisition. The retry path keeps reviewed profile targets only for the same
  source identity and rejects conflicting email evidence. Annotation review no
  longer has a 15-second product cutoff. Known missing-participation notes and
  officer exemptions settle without a model, while model review runs only for
  eligible sheet-marking rows. Identity-only queues do not call the model.
  Officers can explicitly confirm unique same-class name candidates in bounded
  batches. The review UI stays collapsed and renders five rows per page.
- Native Sheet acquisition now reads Drive comment threads inside the same
  source-version fence as values, formatting, formulas, and cell notes. A
  thread is attached to a row only when its quoted cell text identifies one
  cell in the selected range. Ambiguous threads remain counted in immutable
  preview provenance instead of being guessed onto a student. Hosted
  Development reacquired the populated Class of 2029 Spring tab, captured 54
  threads, assigned 43 uniquely, recorded 11 as unmatched, and committed all
  88 rows with no profile-review items.
- The repaired subset rule now imports one dominant class-history row and skips
  a repeated row only when the repeated row contributes no retained activity,
  meeting, requirement, or identity evidence. The Class of 2027 Fall queue then
  exposed 120 same-class duplicate-name groups containing 202 excess unclaimed
  profiles. The 1.2.19 candidate adds a bounded consolidation path for records
  backed by the same official class workbook. It requires exact normalized
  names, the same active cohort, immutable imported-row provenance, no canonical
  contact on either record, and separate tabs or the same repeated coordinate.
  It also refuses overlapping semester membership and preserves every existing
  merge conflict except the missing-email blocker. Local evidence includes the
  complete 6,272-assertion database suite and 2,031 private-plugin tests. Hosted
  Development and Production acceptance remain pending.

- The Class of 2028 Google Sheet test in hosted Development found stale term
  aliases, header-only tabs registered as live sources, repeated one-point
  activity slots treated as nonnumeric warnings, an unbounded preview proposal
  summary, and new-profile commits rejected by their lineage guard. Partial
  source registrations also made the class unlink and stale-source cleanup
  paths fail because they omitted the source's required settings contract.
- The candidate now discovers every canonical term tab from the live workbook,
  records its bounded populated range and one-point-slot provenance, skips
  header-only templates, retires sources from old or missing tabs after a
  successful relink, bounds proposal evidence, and derives activity warnings
  from the parser's unresolved evidence instead of comparing raw slots with
  grouped activities. A forward migration stamps the frozen officer only when
  the created profile's source lineage names the exact import row.
- Hosted Development accepted all populated historical tabs from the official
  workbook: F24 163 rows, S25 129 rows, F25 193 rows, and S26 167 rows. The
  immutable previews retained 8,843 background-color annotations and zero cell
  notes. F26, S27, F27, and S28 were header-only or unpopulated and remain
  visible as semesters without an importable tab. No Production resource was
  read or changed during this acceptance run.
- Current evidence: 62 focused private tests, TypeScript, zero-warning lint,
  source organization, two focused pgTAP files, and a complete local migration
  replay pass. The Development database records 286 active Class of 2028
  profiles and completed import jobs with zero pending or unknown outcomes for
  all four populated terms.
- Browser profiling found that the organization host executed every private
  plugin tab while showing only one. Repeated Classes transitions took
  5.9–6.4 seconds and Applications took 5.3–5.5 seconds even though the DOM
  stayed stable. The host now projects only the selected tab's server content.
  Signed-in local browser checks against the Development backend measured warm
  Classes transitions at 2.7 seconds and Applications at 1.8 seconds.
- Profiles now open the newest semester that has imported records instead of
  an empty current semester. They render one meeting ledger, humanize legacy
  keys such as `november_meeting`, and preserve the source meeting label on
  future imports. The Class of 2028 Development data already contains 1,452
  distinct imported activity events across 208 profiles, including unclaimed
  profiles.
- Class-history rows now retain the workbook's normalized roster key, such as
  `LastFirst`, as source-scoped identity. Resync uses that key before any name
  evidence, keeps equal names with different keys separate, and runs one
  bounded consolidation pass after an authorized sync. The officer Activities
  page now lists exact imported activity labels by class and semester with the
  awarded per-member point range. Historical records remain non-claimable, and
  member profiles continue to show their own activity and meeting ledgers.
- The annotation pass now handles the chapter's known green, red, and yellow
  cell fills before model review. It omits student names and verbatim officer
  notes from model prompts. Notes that say the student was not in Google
  Classroom or submitted nothing settle as not met when no activity is
  recorded. Officer exemption notes settle as exceptions. Conflicting signals
  still require staff review, and yellow cells with activity evidence remain
  unresolved instead of being guessed.
- Member onboarding now uses the installed six-slot class-code input and keeps
  Activities and Point submissions out of the My CSF action list because both
  already have member tabs. Point claims hide single-choice source and semester
  controls, refuse to open when no valid claim path exists, and default the
  semester to the workspace's selected current term.
- A reviewed application-import row can now create an unclaimed profile and
  reconcile that row in one service-only database transaction. The action does
  not link an account or promote an application email into canonical identity.
  The forward migration is present only in the Development project. Its
  function has an empty search path, service-role-only execution, and no new
  Supabase advisor finding. Focused private coverage passes 56 tests, the new
  application and decision pgTAP coverage passes 75 assertions, TypeScript and
  zero-warning lint pass, and the full local migration replay passes. No
  Production resource was read or changed for this extension.
- The 2026-08-30 candidate keeps one linked workbook per class and records both
  populated and header-only canonical semester tabs. Linking prepares every
  populated tab without committing it. Authorized Home and Settings reads
  compare the saved Drive version once per browser session and prepare changed
  tabs as an officer task. Header-only future tabs stay linked as templates and
  create no profiles or participation records.
- Application mapping now uses deterministic aliases first. A model proposal
  is allowed only for an incomplete header match, receives bounded headers and
  redacted column type counts, and is checked against the workbook's real tab,
  row, and column bounds before display. Local evidence includes 2,111 private
  plugin tests, a fresh 414-migration replay with 6,393 pgTAP assertions, the
  CSF database workflow suite, TypeScript, zero-warning lint, source
  organization, and synthetic browser checks for the member feed, combined
  semester history, application review, and officer task views. Hosted
  Development linking and acceptance remain pending. No Production resource
  was read or changed.
- The 2026-08-30 member-profile follow-up removes the application, eligibility,
  and dues tracker from My CSF. Members now see their profile identity, class,
  current-semester totals, and one semester history that preserves exact
  activity names, meeting labels, attendance, service points, and submissions.
  Class joining no longer renders the five-step progress strip or a separate
  Let’s Assist account card. An exact verified-account match asks “Is this
  you?”, shows a bounded recent-activity preview, and offers one confirmation
  action. Name-only candidates still expose only masked roster context and
  require officer review. Evidence on private Development merge `3c34b91`
  includes 14 focused component tests, all 262 plugin test files, TypeScript,
  zero-warning lint, the optimized child build, and fictional local browser
  checks at desktop and phone widths with a clean final console. Hosted
  Development remains a separate gate. Production was not read or changed.
- Repeated soft navigation between Classes and Applications retained detached
  route trees even though only one panel remained visible. A measured 25-step
  loop grew from 101.7 MB to 827.4 MB, 45,627 to 424,442 DOM nodes, and 12,182
  to 110,312 listeners. The host now offers an explicit full-document tab mode,
  enabled only by the CSF workspace. The same loop completes without a crash,
  settles every warm transition below 2.23 seconds, and ends at 76 percent of
  the post-first-cycle heap baseline. Generic organization tabs keep client
  navigation.
- Private plugin PRs #214, #215, and #216 are merged to private `development`
  at `8cb12dd`. PR #216 gives the class creation action a stable React key; the
  member directory then loaded without a browser console error. The final
  compiled isolated browser sweep passed all 81 enabled journeys with four
  expected opt-in evidence skips. Strict plugin verification, TypeScript,
  zero-warning lint, the focused host navigation tests, and the isolated
  production build also pass on the exact candidate tree. A sanitized 1440 by
  900 local MP4 records member matching, pending review, officer decisions,
  point review, and linked workbook preparation without names, emails, join
  codes, comments, or evidence.
- The scale-hardening candidate groups Officer Home and My CSF into one
  permission-checked database read per surface. Class settings resolves every
  term readiness state in one call. Point submissions and appeals use stable
  keyset pages with 25 unresolved and 50 settled records, while proof links are
  signed only for the selected claim. Member selectors search after two
  characters and return at most 20 profiles. Feed posts include three reply
  previews and load older replies on request. The forward migration adds the
  supporting partial and prefix indexes and leaves each new function
  executable only by `service_role`. Local evidence includes a fresh migration
  replay, 26 focused pgTAP assertions, 120 focused private test cases,
  TypeScript, zero-warning lint, and source-organization checks. Hosted
  Development and Production were not changed.
- The 2026-08-31 Development reconciliation prepared all canonical tabs for
  Classes of 2027–2030, but the first officer batch correctly queued zero of six
  Class of 2027 previews. Those previews carried stable roster keys but no
  existing profile targets, and the prior batch gate treated every targetless
  class-history row as unresolved. The candidate now allows a targetless row
  only when it has a valid canonical roster key. During commit, the first term
  creates the profile and later terms from the same organization, class, and
  official workbook reuse it inside the locked transaction. A different
  workbook, invalid key, conflicting canonical email, or a key already bound
  to multiple profiles remains blocked for officer review. The reused profile
  is recorded on the immutable row and in private audit evidence. Private PR
  #221 merged at `618a13e`; 65 focused readiness tests, 18 focused pgTAP
  assertions, TypeScript, zero-warning lint, migration replay, all 265 plugin
  test files, and the 6,502-assertion isolated database suite pass. Hosted
  Development migration, deployment, batch commit, and count-only
  reconciliation remain open. Production was not changed.

## Class member count scoping repair, 2026-08-24

- A read-only Production check of the Class of 2028 Members workspace showed
  zero class rows while its header reported one directory member, one connected
  account, and one member needing attention. Production aggregate checks
  confirmed that the class has no profile, account, or semester-membership rows.
- `plugin_data.csf_list_profiles_page` applied `p_cohort_id` to the returned
  rows but calculated its five header counters from the unfiltered organization
  directory. The migration candidate now applies the same optional cohort
  filter to the counter projection. Calls without a class remain organization
  wide.
- The pgTAP fixture now includes two classes in the same organization and
  checks directory and attention counts for each selected class. A fresh
  disposable database replay applied all 378 migrations, exposed 85 CSF
  tables, and passed all 6,147 assertions across 190 pgTAP files.
- Root PR #300 merged the repair to `development`; release PR #301 merged it to
  `main` at `1213d741`. Production schema workflow run `32717261485` passed its
  exact-tree validation, fresh replay, pgTAP, dry run, push, and parity gates.
  Production now records migration
  `20260824123000_scope_csf_member_counts_to_class`. A read-only call for the
  empty Class of 2028 returned zero directory, semester, connected, and
  attention counts. The function remains security-invoker and executable only
  by `service_role`. Supabase advisors reported no finding for this function or
  migration.

## Production communications repair, 2026-08-24

- Production audit found one configured member announcement topic, three
  missing CSF audience topics, two disabled duplicate webhook endpoints, and a
  sending credential that is intentionally too narrow for topic management.
  The production dispatch workflow's recent scheduled jobs were cancelled
  before runner assignment. No campaign or delivery attempt was present in the
  inspected production organization, and no recipient email was sent during
  the audit.
- The source candidate separates `RESEND_MANAGEMENT_API_KEY` from the existing
  sending key. Topic setup uses only the management client, while the worker
  retains the restricted sending credential. Local and CI-shaped development
  launchers clear both provider credentials.
- Activity creation as Published and draft-to-published status changes now
  expose a default-checked `Also email members` option that the publisher can
  clear before submitting. A checked first publication
  creates one source-linked, consent-aware campaign in the durable ledger.
  Publication and queueing remain separate reported outcomes. Database guards
  require `manage_opportunities`, freeze the exact semester and optional class,
  keep one live campaign per activity, and refuse source drift or browser-role
  execution.
- Current candidate evidence: the activity campaign pgTAP contract passes 21
  rollback-only assertions; focused activity and action coverage passes 25
  tests; email and topic coverage passes 53 tests; TypeScript, zero-warning
  lint and source organization pass; the isolated private runner passes all
  207 discovered plugin test files, and the strict submodule initialization
  and containment check passes at the published private merge. The optimized
  Next.js Production build passes with explicit local-only Supabase placeholders.
  The fresh isolated database replay applies 375
  migrations, exposes 85 CSF tables, and passes 6,109 assertions across 188
  files. The broad one-process private test command remains unsuitable because
  global Bun mocks cross-contaminate files; the repository's isolated test
  runner is the release gate.
- Private PR #118 passed `plugin-quality` and GitGuardian, then merged to
  private `development` at `d6bc4f5`. The Production Resend account now has
  separate opt-in topics for staff, partner representatives, and applicants in
  addition to its existing member topic. The older Production webhook whose
  creation time matches the stored Production signing-secret setup is enabled;
  the later duplicate remains disabled. No webhook was deleted and no email
  was sent.
- Root PR #284 passed Quality, CodeQL, GitGuardian, and Vercel, then merged to
  `development` at `ca456499`. Its hosted Development deployment reached
  `Ready`. Release PR #285 passed the same source gates and merged to `main` at
  `09a7b202`; the matching Vercel Production deployment reached `Ready` and
  migration `20260824065333_csf_activity_publication_email` is present in the
  Production ledger. Read-only Production checks confirmed the activity source
  column and campaign function in `plugin_data`, with zero active campaigns or
  delivery attempts. No recipient email was sent.
- Private PR #121 merged the requested class composer behavior at `5a2a21a`: new,
  draft, scheduled, archived, and republished class posts select **Email
  members** by default, while edits to an already-published post remain
  unchecked to prevent repeat delivery. Private PR #125 merged the follow-up
  activity behavior to `development` at `1474fc5`: both first-publication
  surfaces now default the explicit checkbox on while allowing the publisher
  to clear it. TypeScript, lint, source organization, 75 focused tests, the
  207-file isolated private-plugin suite, private `plugin-quality`, and
  GitGuardian passed. No email was sent.
- Root PR #302 merged the exact private gitlink to `development` at
  `467cb357`; Quality, CodeQL, GitGuardian, strict containment, and the local
  plugin release gates passed. Release PR #303 passed Quality, CodeQL,
  GitGuardian, Supabase Preview, and Vercel, then merged the host fallback
  source to `main` at `a7767cc3`. Production deployment
  `dpl_GGt1rkJGwFmNigRzD5EC7Q7YLE2v` is `Ready` and serves that host source at
  `https://lets-assist.com`, but it does not prove the separately selected
  child application changed; Production still selected signed v1.2.10 at that
  checkpoint. Private PRs #126, #127, and #128 prepared, promoted, and synced
  signed v1.2.11, with private `main` commit `d3002879`. Tag workflow
  `32721434002` built and signed the Development and Production artifacts, and
  root integration workflow `32721536604` produced migration
  `20260824123001_publish_dvhs_csf_1_2_11`. Root PR #307 passed CodeQL and
  GitGuardian and merged the signed release record to `development` at
  `06fed219`. Release PR #305 then passed Quality, CodeQL, GitGuardian,
  Supabase Preview, and Vercel and merged to `main` at `cd79d758`. Host
  Production deployment `dpl_2kYgAaYTGqDKQAy16bbi5sCqPawH` is `Ready`, serves
  `https://lets-assist.com`, and is the successful Vercel status for that exact
  commit. Guarded schema run `32722329097` passed full local migration replay,
  pgTAP, schema integrity, security advisors, Production push, and migration
  parity. Signed application run `32722826110` verified the Production artifact
  signature and digest, deployed exact prebuilt v1.2.11 bytes as
  `dpl_AWQpQ2rwqk4rnW5eMCTpUBNMeBRd`, passed the exact health contract, and
  recorded the deployment as healthy and promoted. Service-only idempotent
  transition `46d70f04-dc71-4167-a6c2-737bd65930f4` locked and revalidated the
  same active organization-admin actor, compared the expected enabled v1.2.10
  state, and selected v1.2.11. A post-transition read shows desired and runtime
  version 1.2.11 with that exact selected healthy/promoted application
  deployment. Chrome redirected to Login, and the signed-in Zen session could
  not be inspected while the Mac was locked, so authenticated visual acceptance
  remains pending. The durable ledger still contained zero campaigns, recipient
  snapshots, deliveries, and provider events. No email was sent.
- Root PR #292 merged the recurring worker repair at `1413a098`. The Production
  Vercel team is on Pro, and `vercel.json` owns the bounded recurrence:
  communications dispatch every ten minutes and scheduled-post publication at
  minutes 7, 17, 27, 37, 47, and 57. The GitHub workflows remain available as
  manual, Production-approval-gated fallbacks. Production deployment
  `dpl_93RQbD7d79XicfEXzy1PnRXYkWBv` served `1413a098`; Vercel reported both
  crons enabled with no undeployed or modified definitions. Runtime logs showed
  HTTP 200 dispatch starts at 09:00:57, 09:10:00, and 09:40:03 UTC. An
  authenticated Production probe returned `enabled: true`, checked zero
  campaigns, reported zero faults, and produced zero delivery outcomes. The
  durable ledger still contained zero campaigns, recipient snapshots,
  deliveries, and provider events after those ticks, so the communications
  worker started successfully and sent no email. The scheduled-post route is
  registered but its separate feature flag remains off, so CLEAN-015 stays open
  and this repair does not claim automatic scheduled publication.
- Signed private release `dvhs-csf/v1.2.10` points to promoted private source
  `c23b6067`. Root PR #296 published the signed identity to `main` at
  `3de2e4f5`; Production migration
  `20260824092128_publish_dvhs_csf_1_2_10` records the same source, manifest,
  content, build, SBOM, and required-schema identity. Production child
  deployment `dpl_3A9GPMFaTXCLcHS1QW1taRTDuLYZ` passed the exact application
  health contract and is recorded as healthy and promoted for version 1.2.10.
- The requested owner account was present in the user's authenticated Zen
  session, although Zen did not expose webpage controls to macOS accessibility
  and its Computer Use screenshot remained pinned to a prior Sheets surface.
  The exact service-only transition used by the settings button therefore
  performed the update without any direct install-table mutation. It locked and
  revalidated the active organization-admin actor, compared the expected 1.2.8
  state, selected the healthy signed Production deployment, and completed
  idempotent request `082a0397-608c-497d-9544-0c3fc7271271`, which returned a
  changed result. Read-only verification shows desired version 1.2.10, application
  runtime enabled at 1.2.10, selected deployment
  `dpl_3A9GPMFaTXCLcHS1QW1taRTDuLYZ`, and healthy/promoted deployment status.
- Still open: the separate Production management credential is absent, so
  staff, partner, and applicant provider-topic bindings cannot be saved through
  **Check communications setup**. Member and class announcements remain bound
  to the existing valid member topic. Real delivery proof still requires a
  separately controlled test recipient and was not part of this repair
  evidence.

## Onboarding-link teardown retention — 2026-08-23

- `20260823221000_drop_csf_onboarding_links.sql` removed the
  `plugin_data.csf_onboarding_links` table, its RPC families, and the
  link-request pointer column. Historical `csf_admin_audit_events` rows whose
  actions or payloads reference onboarding links (for example
  `onboarding.direct_invitation_created`) deliberately remain: audit events
  are immutable by trigger and record decisions that actually happened.
  Nothing else from the retired flow remains to clean; the preflight's T3B
  check and `csf_onboarding_links_teardown.test.sql` prove the schema surface
  is fully absent.

## Historical plugin platform foundation candidate — 2026-08-19

### Historical exact-tree refresh — 2026-08-22

- The signed DVHS CSF application release is `1.2.4`. GitHub run
  `32573363484` deployed its verified application artifact to the Development
  child project and recorded deployment `dpl_C5ZHpGf8RPVbw8ss1tEjZy8HKSur`
  as healthy. This supersedes the older `1.2.1` provider status below.
- Publication, deployment, entitlement, install, desired application version,
  and update operation are separate records. Organization updates now use the
  existing leased transition, deployment-health checks, durable idempotency,
  compare-and-set settlement, and audit path. This closes the repository scope
  described by `PLUGIN-FOUND-004` and `PLUGIN-FOUND-005`; generic automatic
  update execution remains intentionally absent.
- The host selects an exact immutable application deployment per organization.
  The generated asset namespace now preserves that selection across nested
  imports with a deployment-keyed, path-limited routing-context cookie. Each
  request still repeats host authentication and the caller-scoped database
  lookup. A fresh 359-migration replay passes, and the uninstall access suite
  passes 48 focused assertions. The preceding exact tree's complete database
  pgTAP suite passed 6,177 assertions. The direct proxy and release-contract
  bundle passes 58 tests, and the literal-import collector passes 7 tests,
  and lint, source organization, plugin boundaries, and TypeScript pass.
- Runtime shutdown now covers both disable and uninstall. Disabling the
  application-runtime flag clears outstanding historical leases, and deleting
  an organization install atomically disables that flag and clears every lease
  for the organization/plugin pair. Reinstall alone cannot revive an earlier
  child deployment.
- The independent private-application gate now gives every install, audit,
  test, and build command a disposable home and Bun cache. It does not inherit
  the developer home directory, and dependency installation runs with lifecycle
  scripts disabled.
  The database/browser CI job uses the same installer in install-only mode, so
  it cannot bypass that credential and lifecycle-script boundary.
- New application releases must use the signed two-artifact Development and
  Production format. Integration rejects the older single-artifact format, so
  every published application release is consumable by the deployment lane.
- The shared host-import scanner covers TypeScript import types as well as
  runtime syntax. Independent child checks resolve bare specifiers through the
  child's parsed TypeScript configuration, so a path alias cannot disguise a
  source import that escapes the declared application root.
  It also covers literal `new URL(..., import.meta.url)` assets and
  `import.meta.resolve(...)` dependencies used by child bundlers. The same
  boundary now scans CSS and Sass `@import`, `@use`, and `@forward`
  dependencies, ordinary local `url(...)` assets such as backgrounds and font
  sources, CSS Modules file-valued `composes` declarations, and TypeScript
  triple-slash path and type references. CSS escapes are decoded before path
  resolution, so those build inputs cannot disguise host source dependencies. Data,
  external, fragment, and protocol-relative stylesheet URLs remain outside this
  local-file check.
  Parsed TypeScript files, project references, and relative extended configs
  must also remain within the child application root. Relative imports use the
  parsed TypeScript resolver before containment checks, including `rootDirs`.
- Host client navigation into the application ignores the ambient host
  `x-deployment-id` and selects the organization's current child target.
  Historical deployment pins are honored only when the same-origin referrer is
  already the child application route, preserving old-page actions without
  confusing a host deployment for a child deployment.
- Manifest validation now applies each configuration property schema to its
  declared default and every enum member, and every required key must name a
  declared property. Numeric and string-length bounds must remain ordered, and
  integer ranges must contain an integer. An installable manifest therefore
  cannot advertise rendered settings values that the host will refuse to save.
- Application-profile release integration compares every published embedded
  plugin tree at its recorded source commit with the proposed private gitlink.
  An application release therefore cannot advance embedded code under an older
  embedded release identity.
- Application routing accepts the historical mixed-case organization username
  shape enforced by the database, so selected child routes can retain their
  deployment-scoped asset context for those organizations. Profile edits also
  preserve an unchanged historical mixed-case username while new names retain
  the lowercase product rule.
- A final independent Claude review reported two P2 candidates. The deployment
  project concern is disproved as a second runtime authorization gate: the
  signed project/team allowlist check occurs before the service-role-only
  provider-ingestion RPC, which then makes the accepted origin immutable.
  Request routing repeats caller and control-plane authorization without
  trusting a client-supplied project identity. The storage-grammar report found
  a real legacy compatibility difference: the embedded private helper admits
  `.` and `_`, while the SDK and every registered manifest use the canonical
  hyphen-only grammar. Documentation and regression coverage now state and pin
  that narrower SDK boundary instead of claiming identical behavior.
- A later PR review found two release-documentation defects. The application
  health probe exited before recording a reached HTTP 4xx/5xx response, and the
  cutover rehearsal expected 20 pending migrations instead of the verified 22.
  The probe now captures the HTTP status and body before rejecting non-2xx
  responses, so the workflow records them as unhealthy. Focused workflow and
  cutover contracts pass 19 tests. Follow-up review also bounded the probe to a
  10-second connection and 30-second total transfer, and extended the shared
  AST collector to cover literal Webpack `require.context()` roots.
- Final routing review found that an already-rendered prior application version
  lost database access as soon as an admin selected a newer version. The host
  route RPCs now issue a short caller-, organization-, and deployment-scoped
  lease only after repeating the exact healthy-deployment gate. The child access
  proof accepts that lease while still rechecking membership, entitlement,
  install, release, compatibility, deployment health, and force-update policy.
  A follow-up forward migration requires the application runtime flag to remain
  enabled for both lease issuance and lease acceptance, so switching back to the
  embedded runtime invalidates existing leases immediately. Only the currently
  selected route can mint a bounded 12-hour grace lease. Client-callable exact
  asset routing cannot create or renew historical access.
- PR #245 remains the Development-to-Production release vehicle. Production is
  still at 333 migrations through `20260819050728`, with the DVHS CSF install
  enabled on embedded `1.1.0`. No Production schema, child deployment, or
  organization runtime switch is complete until the exact PR tree passes all
  required checks and the Production workflow and acceptance steps below run.

- `PLUGIN-FOUND-001` is repository-closed locally. The plugin registry and
  serializable SDK contract now fail closed, both embedded private plugins pass
  the adapter, and `plugin:check:boundary` is part of CI. Existing host imports
  are a frozen allowlist; new undeclared imports fail. The existing private
  `@/app/**` dependency remains a P1 migration finding before an application
  profile can claim host independence.
- `PLUGIN-FOUND-002` is repository-closed locally. `plugin_form_uploads` now
  binds organization, plugin, and uploader path segments, while preserving the
  pre-membership DV application upload. A fresh isolated replay passed the
  storage contract and the full database suite.
- `PLUGIN-FOUND-003` is repository-closed at the schema boundary.
  `plugin_versions` records complete release identity for new publications and
  preserves NULL legacy provenance honestly. The merged signed-release receiver
  independently reconstructs the embedded source digest, verifies the Sigstore
  bundle, records the signed contract in one forward migration, and opens one
  ordered Development integration pull request with generated pgTAP coverage.
- `PLUGIN-FOUND-004` is repository-closed.
  Deployment observations, workflow-reported health evidence, desired versions,
  manual/security-only update policy, and idempotent lease-bound update
  operations exist. Application activation uses the health-checked,
  idempotent, compare-and-set transition and refuses missing or noncanonical
  deployment URLs.
- `PLUGIN-FOUND-005` is repository-closed. Embedded updates use the leased
  control-plane operation. Application updates use the same runtime transition
  with an exact expected version and selected deployment. The admin dashboard
  presents this as one direct update action instead of a second mutation path.
- `PLUGIN-FOUND-006` remains active until the next signed private release. The
  host now separates moderation, platform, and plugin Gateway authentication,
  falls back to Vercel OIDC, and rejects plugin tracking without organization
  and plugin identity. Private Development PR #71 forwards those tags on every
  DV Speech and Debate model call, but the root gitlink deliberately remains on
  the current signed private release.
- `PLUGIN-FOUND-007` is repository-closed at the local caller-proof boundary.
  The generic application RPC revalidates active membership against the same
  consolidated catalog/install/entitlement model as the embedded host, accepts
  only an exact signed application-profile runtime compatible with the current
  host API, and checks its N/N-1 install range and force-update floor. The CSF projection returns only
  the current caller's role and permission facts. Both use the authenticated
  caller session and expose no roster or CSF domain rows. Ordinary members get
  one generic denial rather than private catalog or entitlement details. Hosted
  Private PR #72 now carries a child app and its independently locked local
  gates, but hosted Development and the Vercel microfrontend remain unverified.
  The original boundary passed a clean 338-migration replay with 28 caller-proof
  assertions. The signed-release and host-API follow-up adds three assertions;
  lint, typecheck, and architecture contracts pass, while its isolated replay
  did not start because local Docker remained in `supabase start` and the first
  CI attempt found its selected port occupied before migrations ran.
- `PLUGIN-FOUND-008` is repository-closed on this candidate. The signed root
  release integrator accepts an application-profile release, the code-owned
  registry publishes CSF `1.2.1` while retaining embedded `1.1.0` as its
  fallback, and host startup accepts that profile transition. The private
  source commit `37d0dbd4` is tagged `dvhs-csf/v1.2.1`; its signed release,
  checksums, Sigstore bundle, and SBOM verified before the root publication
  migration and pgTAP contract were generated. The release archive also carries
  every traced Vercel function input and passes the host archive validator.
  Hosted deployment, activation, and routing evidence remain tracked by
  `PLUGIN-FOUND-009`.
- `PLUGIN-FOUND-009` is repository-closed for Development. The exact signed
  1.2.4 archive is Ready on
  the Development child project as deployment
  `dpl_C5ZHpGf8RPVbw8ss1tEjZy8HKSur`, and the Development control plane records
  its exact digest and release tag with healthy status. Vercel Authentication
  protects direct child-domain access. The application manifest path prefix is
  still a contract rather than active host routing. Vercel group
  `mfe_W64mCurqcnCgOvWojPr0FoRQUluS` now contains only `lets-assist` and
  `lets-assist-csf`, with the host as its default app and the reviewed
  access-proof path as the child's default route. Vercel charges no project fee
  for these first two projects. The $2 per million routed-request overage was
  explicitly approved. Production deployment and organization activation are
  tracked as release steps rather than repository defects.
- `PLUGIN-FOUND-010` is repository-closed on this candidate. Application
  runtime changes now use a browser-stable request ID, a durable payload-bound
  receipt, and a database compare-and-set check. A delayed retry returns its
  recorded outcome without restoring obsolete routing. Settings keep the
  selected version and its deployment health separate from the newest
  available release. A fresh 351-migration replay, 35 focused pgTAP assertions,
  TypeScript, focused ESLint, and the architecture audit pass locally. Hosted
  Development migration and browser acceptance remain release gates.
- `PLUGIN-FOUND-011` is repository-closed locally. Static microfrontend routing
  could move every organization to the newest child deployment even when its
  install selected an older version. The host now resolves the exact healthy
  immutable Vercel deployment through an authenticated, membership-scoped RPC
  and rewrites the application page without changing its public URL. The shared
  microfrontend group retains only version-independent health and generated
  child-asset routes. The child build emits the namespaced asset URLs, while
  Vercel Skew Protection pins framework-managed asset requests to the deployment
  that rendered the selected page. The isolated runner now owns both platform
  and child processes, routes the namespaced assets locally, and excludes
  platform authority from the child environment. The same migration makes an
  omitted host API maximum genuinely unbounded in both status and activation
  paths. A fresh 353-migration replay, 52 focused pgTAP assertions, 63 focused
  runner and proxy assertions, TypeScript, architecture checks, and a live
  two-process local startup pass. Hosted Development migration, Skew Protection
  confirmation, protection-bypass setup, and browser acceptance remain release
  gates.
- Private release `1.2.1` is signed and published. Root PR #238 merged it into
  `development` at `411421a9bf9ea3f1aa251abda3f7664f054d48ea`, and hosted
  Development is migration-current at 342 rows through `20260821044815` with
  the application release still at zero rollout. The complete signed-identity
  guard is a new forward migration pending on PR #239; the applied ledger rows
  remain unchanged. The exact hosted Development child deployment is Ready and
  healthy behind Vercel Authentication. The
  two-project microfrontend group exists, but its committed config, paid routed
  traffic, activation, and hosted browser acceptance remain pending. Production
  remains untouched.

## Historical Production release candidate — 2026-08-18

- Production review findings `PROD-REV-001` through `PROD-REV-007` are
  repository-closed on the follow-up candidate: feedback unsubscribe GET is
  confirmation-only; the feedback worker rotates through bounded stable pages
  without a creation-date exclusion; paper scans require active organization
  membership and use compare-and-set extraction ownership tokens; the three
  replaced CSF functions explicitly restore service-role-only execution; and
  removed legacy workbook commands are no longer advertised. Focused evidence
  is 27/27 Bun assertions, 10/10 pgTAP assertions, clean migration replay,
  formatting, zero-warning lint, and TypeScript. Hosted Development and
  Production acceptance remain separate release gates.
- The second Production review pass is repository-closed on the follow-up
  candidate: paper-scan discard now locks against commit and writes its Storage
  deletion outbox, image purge markers, and terminal batch state in one
  transaction; email-token feedback edits reset moderation before the AI call.
  Focused source contracts and 11 rollback-only pgTAP assertions cover these
  boundaries. Hosted Development and Production acceptance remain separate.
- Private plugin PRs #65 and #66 are merged. DVHS CSF `1.1.0` is pinned to
  private main commit `4d1001e9d3269b8bd28de93c071c6b4b216824fd` and manifest
  SHA-256 `04aca8efa43e9d287c8d04909b733df97f6804224a4c6960a3609358eb574e79`;
  PR #67 synchronized that Production ancestry back into private Development.
- `20260818040246_generalize_private_plugin_storage_and_publish_dvhs_csf_1_1_0`
  replaces the empty `csf-private` bucket with one server-only `plugins` bucket,
  namespaces DVHS CSF objects under `{organizationId}/dvhs-csf/...`, rewrites
  the reviewed SQL producers/validators, advances installed versions with audit
  rows, and publishes the immutable source/manifest release attestation.
- Local evidence: clean 324-migration replay for the prior candidate; the new
  325th forward ACL migration replayed successfully and its 5/5 pgTAP
  assertions passed, while three unrelated tests hit transient Docker DNS
  resolution failures. The hosted CI replay remains the final clean-tree gate;
  840 focused pgTAP assertions;
  zero-warning lint; typecheck; strict private-gitlink containment; manifest
  digest/source gate; and release/preflight documentation contracts pass.
- The pasted advisor exports are triaged, not mass-applied. `plugin_data` RLS
  with no browser policies is intentional because the schema is server-only;
  unused-index findings are observation signals, not deletion authorization;
  and foreign-key indexes are added only for demonstrated join/delete paths.
  The pending `20260811132454_disable_unused_pg_graphql` migration is expected
  to remove the Production GraphQL exposure warnings. Hosted Development and
  Production advisor scans after exact migration parity remain required proof.
- The final Production review found two additional P1s. Registered paper-scan
  photos are now deleted only when batch creation never succeeded; an ambiguous
  extraction response reloads the durable batch instead of deleting review
  evidence. `20260818160000_review_project_feedback_trigger_acl` explicitly
  grants the feedback trigger function only to `postgres` and revokes direct
  client/service invocation. Focused evidence is 9/9 Bun and 5/5 pgTAP.
- The final publication-race review is closed at the database boundary by
  `20260818170000_serialize_paper_attendance_publication`: paper attendance
  locks its parent project before commit, and a stale hours-publication
  snapshot cannot mark a session published while an eligible attended signup
  lacks a verified certificate. Candidate roster reads also fail closed on a
  database error. Focused evidence is 15/15 Bun assertions and 8 pgTAP
  assertions; the clean 326-migration hosted replay remains the authority for
  that merge.
- The final ACL audit is closed by the forward-only
  `20260818180000_complete_function_acl_restoration` migration. All twelve
  restated partner functions, both paper-notification triggers, all four
  plugin-release guards, and the hours publish-key helper now carry explicit
  reviewed owner/executor grants. Legacy response-loss-unsafe point-resubmit
  and profile-merge signatures remain unavailable to `service_role`; only the
  existing purge and trigger boundaries retain it. Focused pgTAP passes 10/10,
  and the repository candidate is 327 migrations with 165 pgTAP files and
  5,949 assertions.
- The remaining application-decision and meeting-authorization ACL review is
  closed by `20260818223637_complete_remaining_function_acl_restoration`.
  Its six owner-internal helpers now carry explicit `postgres` grants while
  remaining unavailable to `anon`, `authenticated`, and `service_role`; server
  callers must continue through request-aware entrypoints. The repository
  candidate is 328 migrations with 166 pgTAP files and 5,954 assertions.
- The final import/profile owner-internal ACL review is closed by
  `20260818232541_complete_final_owner_internal_function_acls`. Its seven
  helpers now record explicit `postgres` execution while remaining unavailable
  to browser and service roles. Paper-signup and project-feedback schedulers
  also fail closed when their authenticated endpoint reports `enabled:false`,
  preventing false-success heartbeats. The repository candidate is 329
  migrations with 167 pgTAP files and 5,959 assertions.
- The final Production race review is closed by
  `20260819002500_serialize_plugin_deletion_and_token_feedback`. Plugin
  entitlement changes now serialize with the deletion lease, deletion
  revalidates install/entitlement state after its durable claim, and token
  feedback rechecks attendance plus project completion in the same database
  transaction as the write. The repository candidate is 330 migrations with
  168 pgTAP files and 5,970 assertions.
- The late paper-scan orphan-cleanup review is closed by
  `20260819020000_serialize_paper_scan_orphan_cleanup`. Verified orphan enqueue
  and image registration share one database mutex; a durable worker lease
  blocks registration during external Storage deletion; registration cancels
  stale cleanup work; and the worker rechecks references under that lease. The
  repository candidate is 331 migrations with 169 pgTAP files and 5,978
  assertions.
- The final signup and feedback-preference review is closed by
  `20260819030000_propagate_anonymous_feedback_opt_out` plus the matching
  application changes. Canonical Google signup redirects preserve CSF and staff
  invitation context, while verified anonymous feedback unsubscribe and
  resubscribe decisions propagate to every project-scoped identity for the
  normalized email address through a service-only transaction. The repository
  candidate is 332 migrations with 170 pgTAP files and 5,992 assertions.
- The final owner-internal ACL review is closed by
  `20260819050728_complete_reviewed_internal_function_acls`. The profile-merge
  audit trigger, profile-merge implementation, import-row commit implementation,
  import compatibility helper, and recurrence trigger now record explicit
  `postgres` ownership and execution while remaining unavailable to browser and
  service roles. The repository candidate is 333 migrations with 170 pgTAP
  files and 5,992 assertions.
- PITR is intentionally not part of this release. The cutover runbook requires
  a verified logical backup/restore path instead. Production remains unchanged
  until the root Development and Production promotion gates complete.

## Historical CSF renderer repair candidate — 2026-08-17

- Repository finding: every CSF response rendered all five dashboard route
  families. Repeated Applications list/detail soft navigation retained the
  unrelated React Flight and client-component graphs until Chrome terminated
  the renderer with `Aw, Snap!` error code 5.
- Hosted Development remains the read-only failing baseline. In a fresh Chrome
  tab, Applications used 14.7 MB of renderer heap; the first detail reached
  59.2 MB, returning reached 103.8 MB, and the second settled detail reached
  213.2 MB. The visible DOM stayed between 437 and 744 nodes, isolating the
  growth to retained framework/component state rather than visible page size.
- The local candidate is this root `development` tree with private
  `development` commit `7331d1e`. The dashboard composition now dynamically
  selects exactly one route family, including the officer-list versus
  member/detail Activities split. The production compiler emits the five
  families as separate server chunks.
- Local repository evidence: all 233 plugin test files pass, including the new
  route-isolation contract; TypeScript, zero-warning ESLint, source-layout
  checks, seed safety, formatting, and the optimized Next.js production build
  pass. The build used non-secret local public Supabase placeholders and did
  not contact a hosted provider.
- Browser acceptance of the candidate remains pending. The isolated fictional
  runtime could not complete its login because the machine data volume reached
  `ENOSPC`, and Docker then stopped responding during namespaced teardown. No
  user file or unrelated stack was deleted to make space.
- Promotion remains private-first. Both local Development branches are one
  commit ahead of their remotes; strict containment correctly fails until the
  private commit is reviewed, published, and merged to private
  `origin/development`. Nothing was pushed, deployed, aliased, merged to
  `main`, or run against Production.

## Historical Development hardening candidate — 2026-08-16

This dated snapshot is retained as historical evidence. It does not override
the authoritative current status under **Repository-owned P0–P2** below.

- Root work is isolated on `codex/development-hardening-20260816` from exact
  Development base `f866bd6`. The user-owned dirty checkout at
  `/Users/riddhiman.rana/Desktop/Coding/lets-assist`, including feedback UI work
  and `.playwright-mcp`, was not staged, formatted, stashed, or modified.
- Private CSF work is committed on
  `codex/csf-reconciliation-guard-20260816` at
  `5e21d5dd60744dc50b7817bfc734a4e2ca71c8f5`. Private-first promotion remains
  mandatory: merge that branch to private `development` before publishing a
  root commit that advances the gitlink.
- The repository candidate has 298 migrations through
  `20260816190454_durable_paper_signup_notifications`. The audited hosted
  Development baseline was healthy and migration-current at 296 through
  `20260816083000_csf_import_annotation_settlement`; this implementation has
  not applied the two new migrations or re-verified hosted parity/advisors.
  Production was verified read-only at 333 migrations through `20260819050728`.
- Implemented locally: authoritative attested plugin releases and fail-closed
  entitlement/install resolution; centralized AI usage/quota/privacy handling;
  Development Resend sender/recipient guards; durable paper-signup notification
  outbox and orphan-upload recovery; attended/completed-project feedback dialog
  with a persistent manual entry point; and private CSF reconciliation guards
  that keep annotation AI advisory/redacted, block Class of 2030 before source
  acquisition, and allow no hosted commit without an exact Development source
  UUID allowlist.
- Current local evidence: static quality is green; the canonical runner passed
  all 247 root and 227 plugin test files; and a synthetic-key Next.js production
  build compiled, typechecked, prerendered all 81 static pages, and completed.
  A generated isolated stack replayed all 298 migrations and passed all 150
  pgTAP files with 6,004 assertions, then seeded the deterministic CSF fixtures
  and passed the architecture, plugin isolation/data-access, release-registry,
  and five-runtime-contract gates. Focused feedback/waiver pgTAP passed 273
  assertions and plugin-release/paper-scan pgTAP passed 65 assertions.
- The canonical `bun run build` and final redesign wrapper intentionally stop
  only at strict private-submodule containment: private PR #51 is published but
  not merged to private `development`. The direct build and every database gate
  before that ordering check pass; this is a promotion blocker, not permission
  to bypass or weaken the check.
- GitHub branch protection is now enabled on root and private `development` and
  `main`: one approving review, stale-review dismissal, last-push approval,
  resolved conversations, up-to-date required checks, admin enforcement, and
  no force pushes or deletion. Root requires `quality`; private requires
  `GitGuardian Security Checks`.
- The live Vercel inventory confirmed that generic Preview still inherited
  legacy Supabase/database and Resend variables. The unscoped Preview records
  for the Supabase URL/publishable/secret variants, legacy Postgres
  host/user/database metadata, and `RESEND_API_KEY` were removed. The
  `development` branch retains its branch-scoped Development values;
  Production retains Production-only Supabase URL and Postgres metadata, now
  stored as Sensitive. No deployment or alias changed.
- The connected Resend team is Let’s Assist-owned and has three previously
  verified Let’s Assist domains, a named Development worker key, four
  Development CSF topics, and one enabled Development webhook. A dedicated
  sending-only `dev-mail.lets-assist.com` domain now exists with tracking off,
  and Vercel Preview branch `development` has a Sensitive
  `RESEND_DEV_FROM_DOMAIN` fence for that exact domain. On 2026-08-16 its
  conflict-free DKIM, MAIL FROM MX, and SPF records were installed DNS-only in
  Cloudflare and independently resolved through `1.1.1.1`; Resend reports the
  domain and all three records verified. All five legacy provider templates
  remain drafts because the app renders the canonical React Email templates
  directly. Per operator decision, the enabled webhook's Vercel
  protection-bypass credential is intentionally retained for now and is not
  recorded here.
- A fresh generated isolated stack exercised the compiled CSF post workflow on
  the current tree. The focused Playwright lane passed 5/5: an organization
  admin published and pinned a synthetic class post, an officer appended a
  follow-up, a member saw the pinned post and reply, a member-role account had
  no compose affordance, and queued-email state remained explicitly distinct
  from provider delivery. The suite cleaned its disposable post rows; the
  stack then passed ownership-aware dry-run teardown and proved zero residual
  labeled containers, volumes, or networks. The authenticated hosted
  Development class workspace was inspected read-only and showed the synthetic
  class fixtures, but no hosted post was submitted and no hosted candidate
  acceptance is claimed.
- The feedback worker and paper-signup notification worker remain disabled by
  default. No provider send, webhook registration, hosted apply, deployment,
  alias promotion, database mutation, real-source commit, or Production data
  operation occurred.
- Real 2027-2029 sources remain immutable-preview-only and permission-aware.
  Class of 2030 remains template-only. No real student rows, attachments,
  emails, or scan images were copied into fixtures, logs, screenshots, model
  prompts, or committed artifacts.
- Remaining release gates: merge private PR #51 after review/CI, rerun strict
  containment and the canonical build/redesign wrappers, publish a root
  Development PR, run the remaining isolated browser suites and hosted
  synthetic role acceptance on the deployed candidate, run the synthetic
  Resend acceptance matrix, and capture measured
  provider/advisor evidence. Provider templates are not a release dependency
  while application sends continue to render the reviewed React Email source.
  Production promotion is a separately authorized program.

## Historical exact release-candidate evidence — 2026-08-17

The root release candidate is the clean worktree branch
`codex/csf-production-readiness` based on root `development` `f14d96c`, with
its gitlink advanced to protected private `main`
`a55c10d68c04fedd00614bcfdcd6230f17c2d526`. Private `main` is contained in
private `development`, and the strict root submodule containment and remote
reachability check passes.

Exact local gates passing on this candidate: source organization, format,
zero-warning lint, full typecheck, production build, seed-safety and fixture
target guards, plugin release registry contracts, the complete fresh
308-migration replay including the local-only seed, and the three focused
release pgTAP files (20 assertions) for current-school-year staff authority,
safe announcement link-preview persistence, and the DVHS CSF `1.0.0`
catalog/release contract. Private repository CI is green on the exact
published SHA, including the DNS-rebinding-resistant link-preview tests.

The full isolated database/browser gate is not claimed locally: the fresh
isolated Docker stack exhausted local container resources after applying the
migrations, leaving analytics killed and dependent containers unhealthy.
Root CI must therefore run the exact isolated replay and CSF browser suite on
the committed candidate. Hosted Development exact-SHA role journeys,
provider acceptance, Production schema work, and real-data operations remain
pending and separate.

Hosted Development read-only state verified 2026-08-14: the persistent
Supabase Development branch (`project_ref` `ocbuygudvarsuxijxhau`) is
`ACTIVE_HEALTHY` at 286 migrations through `20260813013300`, and the
repository has five pending forward migrations: `20260813020000`,
`20260813085442`, `20260813091801`, `20260814001123`, and `20260814051720`.
Current hosted advisors: security 98 INFO / 0 WARN / 0 ERROR; performance
613 INFO / 0 WARN / 0 ERROR, to be rerun after the pending apply. The
authenticated Vercel team is Lets Assist Team with project `lets-assist`; no
final closeout deployment exists yet.

These results do not claim a real student commit, a Drive mutation, a
provider send, a hosted Development apply, hosted browser acceptance,
Production readiness, or any `main` change. The real 2027–2029 workbooks
remain preview/read-only only.

Status is recorded once below. Historical tables later in this file preserve
finding detail as evidence only and are explicitly superseded as status
sources.

## Repository-owned P0–P2

### Organization read latency, September 11, 2026

`bcc1455b` passed CI run `34589118187`: 484 migrations, 275 SQL files,
7,907 assertions and 93 CSF browser tests (four optional skips). Hosted run
`34588559651` failed the read latency gate: p95 3,355.81 ms and p99
8,602.77 ms. Mutation p95 1,344.52 ms, LCP 1,324 ms and INP 48 ms passed.
The run recorded two timeouts and no HTTP 5xx responses.

The organization page loaded platform report totals and overview extensions
for CSF even though CSF hides the platform Overview tab. Metadata and page
rendering also queried the same public organization separately. The bounded
root correction skips hidden overview reads and shares the public projection
within one React server render. Authorization remains fresh. Local source and
regression evidence does not establish a hosted latency improvement; the
read gate remains open until measured on the integrated candidate.

Production remains at `840` with 482 migrations and application 1.2.24.
Imports are paused at revision 4, verified by runs `34589218794` and
`34589285371`. This correction changes no provider state or private gitlink.

### Production source and profile repair, September 9, 2026

The owner authorized direct Production repairs, then explicitly requested no
further work on Development. This entry supersedes the older current-state
paragraphs below for this repair.

- Fall 2026 now has 170 committed applications. Added contacts to 170 uniquely
  matched same-class profiles, including 91 school and 128 personal addresses.
  Contact provenance remains unverified. No login account was linked and no
  application decision was approved.
- Restored all 340 current transcript and receipt URLs from matching saved
  Drive IDs. Restored 680 original course lines for the 151 applications that
  supplied courses, matching both evidence IDs, course names, and grades to
  the live source. Officer decisions and operative point values did not change.
- All 1,910 historical workbook rows are accounted for: 1,908 exact matches
  and two previously audited profile merges. All 1,117 green workbook rows
  have completed memberships. Corrected 612 standings with source coordinates,
  workbook hashes where applicable, explicit overrides, and audit records.
- Archived Classes 2024 through 2026. The directory migration excludes their
  543 profiles from default results and counts, leaving 819 visible profiles.
  The Class of 2026 screenshot example returns no general search results.
  Explicit archived-class review and retained evidence remain available.
- Verified profile-repair checkpoint: deployment
  `dpl_FxaY5uSSwZT4Ak4hAk5HutX2Ujhi` served `08efbe46`.
  The live alias, full database/environment checks, login, protected-route
  redirect, removed join date, historical application panel, and officer
  completion display were verified. Hosted Development was not used as the
  acceptance gate for the owner-authorized direct Production release.
- Private PR #280 passed CI and merged to main as `f18d868`. The live account
  review shortcut reaches the correct class queue and its empty-state guide.
  Local TypeScript and strict main publication validation pass. The Production
  release suite passed 106 tests; documentation and integration passed 19 tests.
- Production has 474 migrations, ending at
  `20260909173201_csf_optional_reported_course_text`. The full database
  suite passed 7,466 tests, including eight archived-directory regressions.
  The exact Production catalog query passes with its pinned function body and
  execution permissions. A forward correction prioritizes active class
  membership over newer transferred rows. No current profile had that mismatch.
  All ten directory assertions passed in a rolled-back Production fixture.
  Root PR #505 targets main and records the final deployment identity.
- Course imports now carry bounded reported text through the immutable snapshot
  into the existing course entry. Legacy snapshots retain the same derived
  payload, including explicit null course text. Sixteen rolled-back Production
  checks verify retention, bounds,
  unchanged point and bonus rules, and internal helper permissions. The adapter
  suite passed 39 tests and local TypeScript passed.
- Browser regressions now expect the connection guide to remain visible after
  a request is resolved or rejected. They still verify the settled request and
  resulting account state.
- Onboarding follow-up: created the missing permanent join codes for Classes
  2027, 2029, and 2030 through the live staff form. Class 2028 kept its code.
  All four active classes now have one active code; archived classes have none.
  Production passed 245 rolled-back checks covering profile creation, class-code
  lifecycle, repeated joins, exact-email connections, account-name confirmation,
  conflicting identities, and officer connection review. No fixture remained.
- P2 found during live onboarding checks: Add member in Class 2030 defaulted to
  Class 2027. Private PR #282 passes the viewed class into the form and requires
  explicit selection outside a class. Root browser coverage asserts the default
  and the persisted class membership. The form points officers to Record
  connections for waiting accounts. Production publication is tracked in the
  main-targeted onboarding follow-up PR.
- Remaining: source rows 21 and 143 have the same name but conflicting classes,
  contacts, and evidence. They remain unresolved. Permanent removal of retained
  alumni records is separate from archiving.

### Current Production state, September 9, 2026

Production now serves `1fbf92268b729250f73fa09523673544a7d25b3e`, with private
gitlink `fdaec9d0c57904ba72aa34db81c8985507346de1`. Deployment
`dpl_BKmfTGXXyXDTpYY2WZL3pLDqqN8m` passed app-only run `34315876545`, including
the exact schema and catalog, staged backend and routes, promotion, and public
alias verification. A separate Vercel lookup of `lets-assist.com` resolves to
that exact deployment and SHA. Root PR #500 merged as `da1e7a2a`; the previous
deployment is `dpl_H9JE7aGUueg1PpCwQqcauhbnosrG`. This follow-up used one
Development deployment and one Production build, with no migration changes.

Hosted acceptance `34313306933` passed 9,807 requests from 100 distinct sessions
and identities, with zero request errors or 5xx responses. Read p95 was 1.217
seconds and p99 1.563 seconds. Classes p95 was 1.581 seconds, Applications
1.904 seconds, and mutation p95 1.357 seconds. LCP p75 was 1.364 seconds, INP
p75 32 milliseconds, and CLS p75 0.000816. All 25 review navigations passed;
retained heap was 11.5 percent below baseline. CI `34313484352` passed root and
plugin tests, lint, TypeScript, build, database replay and scale checks, three DV
browser tests, and 89 CSF browser tests. Four CSF skips remain exclusions.

`CSF-SHEET-METADATA-SERIALIZATION` is fixed and verified in signed-in Development
Chrome. The new fictional Sheet selected successfully, detected Fall 2026, and
assigned all four rows to their own classes. Its automatic-update consent is
saved. Its background preparation remains untested because Development workers
are disabled and the existing single-workbook runner cannot fence other queues.
Do not rotate secrets or weaken that runner to manufacture a passing receipt.

`CSF-AUTO-SOURCE-EVIDENCE` is fixed and now verified by the live Production
worker after activation `34316453087`. It issued evidence receipts, prepared
142 unclaimed profiles under the existing officer authorizations, and queued
84 Spring rows and 58 Fall rows. Read-only checks show approved frozen scope
and zero source-evidence blockers for both queues. Spring queue
`7e83ebd0-5af2-4761-858a-57b3b054ffb3` uses preview
`75fd2b32-be8a-4deb-be21-14cad2f62e33`. Fall queue
`4ecc7cba-1936-452b-af2f-d770f29d8764` uses preview
`35363178-273b-4a95-b7de-36bcd0a49b81`, provider version 365 and 169 rows.
Spring retains 517 rows. The pending rows include 540 ambiguous matches and
four conflicts. They were not merged by name. Import activation `34316723202`
passed. Both workbook and import workers are enabled at runtime revision 2.
Communications remains disabled with no campaign or dispatch backlog. Production
controlled test-address settlement is still open.

The Spring worker committed 84 applications, including 83 Class of 2026 alumni
and one Class of 2028 applicant. Fall provider version 365 changed before commit,
so the original queue retained `source_check_failed` with no application writes.
Version 367 contained 170 rows. Its new preview
`a18e6159-6103-4238-a491-21f0cd266861` lost the prior profile-creation matches.
Read-only comparison proved 58 rows retained the exact source, mapping, row
coordinate, row hash, full normalized application, class, and semester of their
audited profile-creation receipts. The existing permission-checked
`csf_reconcile_sheet_import_row` action recovered those 58 matches with reasons
and origin-row metadata. No direct table repair or name-only merge occurred.
The normal worker then committed them through queue
`7dba6c75-c232-4da9-9516-890c3d3c20ae`.

Current application counts are 142, all pending decisions and all with source
row and job receipts. Fall counts are Class of 2028: 4, Class of 2029: 32, and
Class of 2030: 22. Spring counts are Class of 2026: 83 and Class of 2028: 1.
There are 878 active profile records and 311 retained merged records. Active
profile records do not imply current-semester membership. The remaining current
previews contain 545 officer-review rows: 433 Spring and 112 Fall. Their partial
queue status does not negate the 142 successful application receipts.

`CSF-AUTO-PROFILE-CREATION-LINEAGE` remains an open P1 defect. A provider change
between profile creation and application commit leaves the new profile durable,
but the replacement preview accepts only successful application commit lineage.
It therefore marks the already-created profile ambiguous. The Production repair
above handles this incident, not future recurrence. Add synthetic coverage for
this exact sequence and preserve source, mapping, identity, permission, and
unknown-outcome checks before changing the generic recovery path.

The manual Add applications button also remains disabled when safe rows coexist
with unresolved rows. The automatic worker successfully committed the safe Fall
rows independently. This is a remaining manual-flow discrepancy, not evidence
that uncertain rows were imported.

The generic profile-creation retry repair is now implemented locally. A
permission-scoped audit lookup verifies the same source, mapping version,
authorization generation, row, and profile. Only a resolved row whose application
write has not started can supply `profile_created` lineage. The next preview
also requires an unchanged normalized row hash, a unique current candidate,
matching class and semester, and unchanged applicant identity/contact evidence.
Ambiguous intermediate retries can trace that proof through unchanged source
rows. Unknown, in-flight, failed, changed, skipped, and conflicting evidence
remain blocked. The repair does not label profile creation as application success.

Thirty-one focused lineage and audit-proof tests pass with 85 assertions. Two
additional full preview-path tests pass with eight assertions: an audited profile
becomes a pending application target, while a name-only candidate or changed
snapshot remains ambiguous. The loader uses organization-scoped batches of up
to 200 rows, limits ancestor traversal to 32 steps, and refuses duplicate or
truncated audit evidence. No database migration, commit receipt rewrite,
Production data mutation, or hosted deployment was performed for this local
repair. The grouped acceptance run and live retry remain open.

Historical source setup continued through the signed-in Production UI. The
Google picker granted access to the exact Fall 2025 and Spring 2025 response
workbooks. Their detected columns retain timestamp, response email, name,
preferred contact, grade, returning status, courses, claimed point totals,
transcript, and receipt separately. Neither form email becomes a verified
profile email. Both sources have explicit officer automatic-update consent.

Fall 2025 source `fcb39ec0-ee7c-4d79-9248-e824bffd3ba0` prepared provider version
2070 in preview `cb76abd8-a7e2-49c2-a267-872aca4d0d63`: 601 rows, 52 committed
and 549 needing identity review. Committed counts are Class of 2026: 44,
Class of 2027: 2, Class of 2028: 2, and Class of 2029: 4. All decisions remain
pending. This raises verified imported applications to 194 at this checkpoint.

Spring 2025 source `0c0c7d37-3605-4cdb-9329-a8d36cc8a79b` initially exposed
111 senior responses without a Class of 2025 target. The ordinary Create class
and semesters action created that missing alumni class and its eight historical
semesters. It created no member or application approval. Worker preview
`a2c68cff-9cf8-40f6-9f5e-899bc3b9a118`, provider version 968, now has 583 rows:
136 resolved imports and 447 identity-review rows, with no missing-class errors.
Subsequent readback confirms all 136 committed: Class of 2025: 111, Class of
2026: 24, and Class of 2027: 1. Production now has 330 imported applications
across these four semesters, all pending officer decisions and all retaining
source-row and job receipts. No application was approved by these imports.
Older application sources, the remaining identity exceptions, and final repeat
sync reconciliation remain unfinished.

### September 9 grouped import release continuation

Production application counts rechecked at 09:54 UTC. These are imported
applications, not approvals, active memberships, or completed source
reconciliation. Each nonzero cell has the same count of distinct profile IDs
within that class and semester. Zero means no imported application in that
cell, not that the source contains no responses.

| Class | F23 | S24 | F24 | S25 | F25 | S26 | F26 |
| ----- | --: | --: | --: | --: | --: | --: | --: |
| 2024  |   2 |  82 |   0 |   0 |   0 |   0 |   0 |
| 2025  |   5 |  45 |  55 | 111 |   0 |   0 |   0 |
| 2026  |   6 |  51 |  35 |  24 |  44 |  83 |   0 |
| 2027  |   1 |   8 |   2 |   1 |   2 |   0 |   0 |
| 2028  |   0 |   0 |   4 |   0 |   2 |   1 |   4 |
| 2029  |   0 |   0 |   0 |   0 |   4 |   0 |  32 |
| 2030  |   0 |   0 |   0 |   0 |   0 |   0 |  22 |

Run `34335768759` completed both `supabase test db` on its isolated stack and
the CSF database workflows successfully for candidate `4f36f545`. Worker
authentication and browser checks are still running. The run's quality job
remains failed only at formatting, corrected locally but not yet pushed.
The temporary PostgreSQL process owned by this task was stopped cleanly after
catalog inspection. Its private temporary files remain; shared Docker data
was neither reset nor deleted.

Protected diagnostic classification confirms that Production Fall retry
`460326b9-847b-4d3d-9df8-7b88eafee5ed` hit the same caller-selected application
target refusal reproduced in Development. Its job error stores only the generic
`preview_failed` code; the scoped sync diagnostic identifies the append
boundary. Boolean checks found no mapping, authorization, timeout, or network
failure in that diagnostic. No student values or raw diagnostic contents were
returned. PR #503 addresses this path, but live recovery remains unverified.

Root PR #503 pins `4f36f545` and private merge `ba8030f`. The full local root
rerun passed all 310 discovered files. Run `34335768759` failed formatting in
two release-catalog modules while database replay continued. Prettier corrected
those two modules locally; 33 focused catalog/controller tests and the full
format check pass. Do not interrupt the running database job with a new push.

Production readback still has 468 migrations through `20260908141739`, four
linked class workbooks, and 626 applications across seven semesters, none
approved. The chapter communication ledger has zero campaigns, recipients,
and dispatch attempts. A new Fall 2026 retry receipt
`460326b9-847b-4d3d-9df8-7b88eafee5ed`, created at 09:35:07 UTC, failed with
zero preview rows. Its original successful application receipts remain counted
in the 626 applications. Latest-preview totals alone therefore undercount the
58 existing Fall applications. This retry still needs protected diagnosis and
must not be reported as a completed sync. No Production write was made in this
readback.

The final candidate gitlink is private Development merge `ba8030f`, whose tree
matches tested private repair `d91e296` exactly. After switching this isolated
submodule to its Development branch and fast-forwarding, strict submodule checks
passed. The first strict check correctly refused the earlier feature-branch
checkout. No unrelated worktree or branch was changed.

Private PR #277 passed run `34335216443` and merged as
`ba8030f66f6e04d38d045d1e43d762d4f9c52ead`. The root index now pins reviewed
private commit `d91e29688ca348b09d74af59f9ff5d7a0b7baed4`, confirmed reachable
from private Development. The root worktree fast-forwarded to `cb3e18d8`
without changing or discarding its local repair files.

The pending append migration also makes an unproven application superseded
request ambiguous rather than leaving it pending without a profile. Existing
source-bound recovery may then restore a proven target; failure to prove the
identity leaves it for review. Added pgTAP cases exercise that fallback.
The temporary socket-only PostgreSQL instance accepted the updated function
definition with body checking disabled and returned body digest
`13e8ee1bc7b071f00664f808b2cf504a`. This verifies catalog bytes only, not SQL
execution or Supabase replay. Fifty focused release tests pass. No hosted
migration or Production deployment occurred.

Private repair `d91e296` is pushed in private PR #277. Its quality run
`34335216443` is in progress. It has not merged and the root gitlink has not
advanced. Root TypeScript passed again after the additional retry tests.

The full root run finished with two reported failures and one module error.
Both reported failures refer to the same stale runbook ledger assertion.
The module error came from the old eight-migration controller tail. The
runbook now distinguishes the 470-entry local candidate from 468-entry
Production. The controller pins only the two pending migration files and
requires the existing 468-entry prefix, retaining its disabled-worker lock,
exact file hashes, single submission, and read-only outcome recovery.
The 24 focused documentation and migration-controller tests pass with 304
assertions. This is not database replay or permission to deploy untested SQL.

Hosted acceptance `34331389754` completed successfully on Development
`cb3e18d85271c93716c827ee11e7d0a8d2e0da53`. Its log records 9,829 requests;
the slowest reported read p95 was 1.125 seconds and mutation p95 was 1.822
seconds. This run does not cover the uncommitted database retry repair or
close the observed application-import failure. Production PR #502 remains draft.

The private test runner passed all 311 discovered test files. Four additional
focused cases now preserve unchanged retry, conflict, error, and skip states
while removing caller-selected application targets. The focused suite passes
14 tests with 20 assertions. These are payload-boundary checks, not database
proof of unchanged sync. Full root tests are running through `test:unit`.
The attempted `test:root` command was invalid and ran no tests.

Chrome still reports the Mac locked after the latest unlock reply. No staff
invitation was accepted, no application decision was made, and no Production
deployment was started during this continuation.

The local retry repair now appends application rows without caller-selected
profiles, then calls a new service-only database recovery boundary after sealing.
Migration `20260909090944_csf_application_retry_match_recovery` scans 50 rows per
keyset page and follows at most 32 source-bound ancestors. It checks organization,
source file, mapping, coordinate, class, semester, identity/contact/submission
evidence, prior audited resolution or successful commit, current profile
candidates, and active/frozen work. Recovery records another audited match,
not an application approval or account connection. The caller rechecks its
source lease per page and stops on unknown responses or non-advancing cursors.

Ten focused service tests passed with 16 assertions. Root TypeScript and
zero-warning lint passed after reducing redundant comments in the 800-line
preview action. Added database tests cover the actual append/refusal/recovery
path, preserved profile identity, audit receipts, and repeat recovery. They have
not run yet. Hostile database cases and the exact release-catalog upgrade remain
required before committing this repair. Docker Desktop reports `starting`, but
daemon requests return `unable to start`; do not treat that as a running replay.
Production PR #502 remains draft, and no new hosted deployment was requested.

Local forward migration `20260909090522_csf_application_grade_preview_evidence`
adds the mapped-grade envelope with explicit execution grants. It requires a
numeric grade from 9 through 12 that agrees with the canonical application,
a bounded positive column, bounded nonempty provider display, and no extra
fields. New pgTAP coverage calls the actual append RPC for all four grades,
invalid evidence, and replay. Migration file validation and diff whitespace
checks passed. Database execution is still unverified: Docker was stopped and
the Desktop CLI reported that it could not start the daemon. No migration was
applied to Development or Production. The separate profile-retry repair remains
unfinished.

Live fictional recheck exposed a release-blocking database contract mismatch.
The audited officer action created exactly one unclaimed fictional profile and
resolved one row in preview `c950a53a-1a07-4472-a0c9-ddce6236b304`. Read-only
Development queries confirmed one profile, zero account links, one resolved
unstarted row, and three unresolved siblings. Recheck then opened preview
`309e4bed-5091-459c-8c8d-52ba2497abdf` and failed at
`csf_append_import_preview_rows`: the RPC rejects an application row that arrives
with `matched_profile_id`, including the service's recovered audited target.
The original receipt and profile remain intact. No application was approved.

The same RPC's closed envelope does not include `applicationGradeEvidence`,
which the new date-formatted-grade parser emits. Code inspection establishes
that mismatch; a database regression must exercise it before release.
Do not remove the caller-target restriction. Persist application preview rows
without caller-selected targets, then restore only database-proven retry lineage
through an audited, permission-checked boundary. Cover profile creation before
application commit, prior officer matches, committed updates, ancestor retries,
changed identity, changed mappings, duplicate candidates, and unknown outcomes.
Add validated numeric-grade evidence to the database envelope separately.

Production PR #502 was opened from Development to obtain exact-commit CI
`34332037818`, then returned to draft after the live failure. Do not merge or
deploy it until these regressions pass. Hosted acceptance `34331389754` is
still running; even a passing load result will not close this import defect.
No Production build or data mutation occurred in this continuation.

Network readback recovered. Development deployment
`dpl_Hf9Xu1ZHTYaJDSJuLpUnQRU9QN3j` is READY for exact merge
`cb3e18d85271c93716c827ee11e7d0a8d2e0da53`. Hosted acceptance run
`34331389754` passed the exact deployment, Supabase preview, and Development
domain checks and started its acceptance tests at 2026-09-09 08:55:05 UTC.
Acceptance is still running. Chrome is accessible after the user's unlock.
No additional deployment was dispatched and Production was not promoted.

CI `34329216103` passed both jobs on `27374ca4`, including CSF browser tests,
isolated health, evidence validation, and cleanup. Root PR #501 merged normally
into Development at `cb3e18d85271c93716c827ee11e7d0a8d2e0da53` at
2026-09-09 08:50:58 UTC. No separate release branch or deployment dispatch was
created. The integration merge is eligible for the existing grouped Development
deployment and acceptance workflow. Git fetch, GitHub run listing, and the
Vercel connector then failed with network timeouts. Deployment and acceptance
start/completion are unverified. Do not restart a build because these readbacks
failed. Production still has no verified follow-up promotion.

Root PR #501 now carries `27374ca4`; CI `34329216103` passed its quality job,
including the build. Its database job has reached the CSF browser workflows
and is still running. The private runtime patch is merged. Current root tests
previously found stale alumni and gitlink documentation contracts. The corrected
documentation contracts pass 19 tests and 425 assertions, and the stable-gitlink
inventory rerun passes six tests. The final complete local runner now passes
310 root and 339 plugin test files, with isolated processes for mocked modules.
Evidence is in `.artifacts/csf/grouped-release-final-tests.log`.

Native Chrome controls can reach the fictional Development import even though
the extension tab handle times out. The new four-row source has no completed
automatic worker preview and no matching fictional target profiles. Its consent
is active, but Development runtime workbook and import controls remain disabled.
The four earlier applications belong to a different source. Do not match these
new rows to unrelated fixtures. Enable and test the new source only after the
grouped hosted acceptance passes. Current consent is not proof of processing.

Read-only Production review setup shows six open application review periods:
Fall 2023, Spring 2024, Fall 2024, Spring 2025, Fall 2025, and Fall 2026.
Spring 2026 needs its review period configured through the officer action.
One active officer position has a linked account. Multiple-officer review
assignment is not yet configured. No transcript or application decision was
made. Resend sending domains are verified, and separate Development and
Production webhook endpoints are enabled. These configuration reads do not
prove application delivery or settlement. Provider webhook responses include
secret-bearing query strings; future reads must strip URL queries before any
output. The exposed bypass values require controlled rotation before closure.

Chrome successfully signed in as the chapter account, then timed out twice.
A native window check confirmed that the Mac had locked again. The existing
invitation remains unaccepted and the action-time access confirmation remains
pending. No Production email was sent or worker switch changed.

Root integration PR #501 contains `4276c6f9`. Its first quality run stopped
because the extended provider test exceeded the 1,200-line test-file limit.
The numeric evidence test now has its own file. Both provider files pass,
with 27 tests and 120 assertions, and the source-layout gate passes.

The release audit also found open critical Next.js advisories, including
`GHSA-2xp9-vwfh-vxw4`, against the pinned 16.3.0 runtime. The official advisory
lists 16.3.3 as patched. Root Next.js packages and the private CSF application
now pin 16.3.3 locally. Private PR #276 contains child commit `cd2a0e9`;
child lint, TypeScript, ten tests, and the optimized build pass. Private CI
`34328767918` passed and PR #276 merged into private Development at `b6a5c1a`.
The root candidate pins exact reviewed child commit
`cd2a0e902046c73410ff1f4e1d03ba7e6fd43f1a`; strict containment passes.
Root TypeScript and zero-warning lint pass. This patch belongs to the grouped
release, not a separate deployment. Neither runtime patch is live yet.

The Mac is unlocked and the chapter Google account successfully signed in to
Production. Its existing staff invitation is open. Action-time confirmation
was requested before accepting access. Readback still shows no chapter-account
organization membership. Production campaign, recipient, and dispatch ledgers
are empty. Communications remains disabled pending controlled delivery proof.

Private PR #275 merged reviewed commit
`66f2b7e57ce4f0eef2048b361ff8ec76d1a0dc66` into private Development at
`ba12e73` after CI `34326094307` passed. The root integration retains this exact
reviewed gitlink. The root provider change preserves numeric evidence for
date-formatted grades. No schema migration is required by these fixes.

The user confirmed that application decisions belong to officers, including
transcript review and split review assignments. Importing must not approve
applications. AI mapping remains limited to headers and redacted shapes;
uncertain identities remain review items. The user also confirmed chapter
account setup for `dvhighcsf@gmail.com` and Production communications activation.
Controlled test delivery and settlement must precede general email activation.
Chrome currently reports a locked Mac. Unlock was requested once while release
work continues. No access change or email activation has occurred in this step.

### Historical application continuation, September 9

Production readback now confirms 626 applications, each pending an officer
decision and retaining source-row and job receipts. By semester: Fall 2023 14,
Spring 2024 186, Fall 2024 96, Spring 2025 136, Fall 2025 52, Spring 2026 84,
and Fall 2026 58. The eight current source previews contain 3,404 rows:
626 created, 2,714 ambiguous, eight conflicts, and 56 errors. This is partial
reconciliation, not completion. No additional app build or migration was run.

New officer-authorized sources are Fall 2024
`51b0c3d7-e106-4b5a-90c7-c8267e7dcccc`, Spring 2024
`819e81e0-74c1-4997-8f78-8ae03cd4ce47`, late Spring 2024
`c496172b-4177-4026-af1b-5f344bc837d7`, and late Fall 2023
`a8b0cabc-5c97-4a3d-b79b-09159f33e633`. The normal officer action created
the missing Class of 2024 and its historical semesters. Late Spring 2024
mapping version 2 explicitly maps its blank-header timestamp column; all 77
preview rows retain submission timestamps. Its 40 committed applications are
included in the Spring 2024 total. The main Fall 2023 response source has not
been located. Copies and secondary tabs have not been assumed to be new data.

`CSF-DATE-FORMATTED-GRADE` is an open P1. The Spring 2024 source has 56 grade
cells formatted as dates. A protected read of those cells' unformatted values
confirmed integers 9 through 12. Acquisition currently discards effective
numeric values before parsing. Retain bounded numeric and format evidence,
preserve displayed values and source hashing, and recover only the mapped grade
field. Do not modify the official Sheet or parse arbitrary dates as grades.

`CSF-MAPPING-EDITOR-SELECTION` is an open P2. Opening column corrections resets
the selected Sheet, semester, tab, and range. The late Spring mapping was saved
after re-entering those selections. Preserve them when opening the editor.

The selection repair is now local. Opening column corrections captures the
current form's semester, tab, range, and header row together with the selected
file identity. The correction form retains the selected Sheet URL and title,
uses those defaults only for that same file, and still requires matching range
inspection before preview. It does not invent a range after failed analysis.
The manual application path now carries the same review-period preparation
request as the main application form; server permission checks remain unchanged.
Fourteen focused scope, dialog, and Google lifecycle tests pass with 92
assertions. TypeScript and changed-file lint pass after the final copy and
hidden-field adjustment. Full rendered browser acceptance remains open. This
change is uncommitted and undeployed.

The grouped local plugin gate now passes all 337 discovered plugin test files,
with mock-sensitive tests in separate Bun processes. The private CSF application
also passed its independent lint, TypeScript, tests, production build, route
inventory, and data-access checks. Root TypeScript and changed-file lint pass.
These checks include the grade-format, creation-lineage, and correction-scope
changes. They do not establish hosted acceptance, a root Production build, or
completion of official application reconciliation. No remote build was started.

The next grouped gate passed 339 plugin test files after the reviewed-row
continuation fix. Newly resolved applications now retain an officer match only
when its audit agrees with the row, source, job, actor, correlation, profile,
mapping version, and unchanged normalized data. The worker can prepare a
successor preview at an unchanged provider version, but only after every exact
row in the preceding frozen approval has a successful receipt. It leaves the
previous approval, imported rows, and receipts intact. Running, cancelled,
failed, and unknown outcomes do not trigger this continuation. The new preview
still rechecks source access, mapping, actor permissions, and identity before
creating its own approval and queue entry.

Private commit `66f2b7e` groups grade-format recovery, profile and officer-match
retry evidence, reviewed-row continuation, and correction-screen selection
preservation. Root TypeScript, changed-file zero-warning lint, and diff checks
pass. The full unit log is in ignored
`.artifacts/csf/grouped-import-recovery-unit.log`. This commit is not merged or
deployed. Production remains on `1fbf9226`; no additional hosted app build or
official-data mutation occurred during this implementation.

The grade-format repair is now implemented locally, not deployed. Google
acquisition retains numeric values only for DATE or DATE_TIME cells, keyed by
absolute source coordinates, and includes them in its content hash. Application
parsing recovers only the mapped grade cell with an underlying integer from 9
through 12 and matching display evidence. It preserves the original display
and records `date_formatted_numeric_grade` provenance in protected preview
metadata. It does not rewrite source cells, reinterpret arbitrary dates, change
class-history parsing, or replace a readable grade. No identities or application
decisions were changed by this code work.

Local checks pass: 112 focused tests with 364 assertions across acquisition,
parsing, normalized adapters, and grade evidence; TypeScript; changed-file
zero-warning lint; and root/private diff checks. Coverage includes sparse rows,
non-A ranges, unchanged and changed source hashes, invalid numeric grades,
mismatched displays, ordinary readable grades, and non-application sources.
The first new parser test used an invalid synthetic term code; corrected fixture
codes now use the existing S24 contract. Full preview persistence, live source
re-preparation, and grouped hosted acceptance remain required. This repair has
not been pushed and caused no hosted build.

A read-only comparison identified 429 potential cross-semester officer matches
using both application contact fields, exact normalized names, class, prior
successful application receipts, and a unique active candidate. No matches were
applied. These form contacts are not verified account emails. Before reviewing
them in bulk, verify that newly resolved rows can receive a new commit receipt
after an earlier partial automatic approval without expanding its frozen scope.

Fresh count-only Production evidence covers 32 class-semester combinations,
1,913 semester membership records, 4,434 imported activity entries, and 1,392
attendance records. Every activity label and raw point value matches immutable
source data with valid catalog links. Every attendance label, key, and original
cell value matches its source row and has a valid term meeting link. There is
one same-name group containing two active profiles; this is a review exception,
not authority to merge. These counts precede the new application commits.
All four class Drive files are accessible. The report and fresh fictional
screenshots are in ignored `.artifacts/csf/production-reconciliation-d8faa1c1.json`
and `.artifacts/csf/browser-1fbf9226/`. No official row values enter those reports.

The paragraphs below retain the preceding release and defect evidence. They are
superseded as current release status by this checkpoint.

Production now serves `d8faa1c13851d26e5782baca048fe4381cb05302` from deployment
`dpl_H9JE7aGUueg1PpCwQqcauhbnosrG`. App-only run `34307944469` passed staging,
backend and route checks, promotion, and public alias verification. Controller
PR #498 merged as `c495f3d0655b8d782315e03b2f0423fd196fad09`. The previous app
deployment is `dpl_8P2hHJAPCLLkyH6NdpxDw2HmPjtF`. The exact 468-version ledger,
full catalog, staff preference permissions, and migration postconditions pass
read-only checks. No migration was resent. A separate unauthenticated terminal
smoke hit Vercel's bot challenge; the signed-in public browser loads the new
Application Sheet modal. Do not count that terminal check as a pass.

Vercel's August 2026 advisory confirms hosted apps need no upgrade or redeploy
for the two reported Next.js vulnerabilities. Its managed image service blocks
the affected AVIF processing path and its runtime uses Linux. The dependency
remains 16.3.0, not patched: https://vercel.com/changelog/nextjs-august-2026-security-release.

Workbook refresh was enabled for this release by audited run `34308610986`.
Imports and communications remain disabled. Official Fall and Spring application
links now have explicit officer-authorized automatic-update receipts, respectively
`0a4ab54e-a569-4166-97f5-6c302386f5ca` and
`70f8f499-6b45-49ba-9eec-31ba4353855e`, both generation 1. Mapping review kept
Fall 2026 and Spring 2026 separate and retained 85 Spring alumni responses.
Fresh previews contain 162 Fall rows and 517 Spring rows. Each has two identity
conflicts. The older Fall preview had only 71 rows. No application is approved
by linking or importing. Official application commits remain unfinished.

P1 `CSF-AUTO-SOURCE-EVIDENCE`: the automatic application worker saves a fresh
preview without issuing the live source receipt before new-profile preparation.
Both Production sources still have evidence generation 0 and no evidenceRevision.
The database correctly refuses both fresh worker previews with a source-evidence
blocker. Local regression tests reproduce the missing call and refusal handling.
The patch reuses the existing purpose-bound source verifier before profile
preparation, using the checked Google owner while keeping the authorizing actor.
No direct metadata repair or schema relaxation is allowed. Private PR #274 merged
as `fdaec9d0c57904ba72aa34db81c8985507346de1`. Private CI `34310167102`, all 304
local private test files, the complete local plugin gate, TypeScript, and
zero-warning root lint pass. The private merge has the tested candidate's exact
tree. Hosted verification and a follow-up release remain required.

P1 `CSF-SHEET-METADATA-SERIALIZATION`: selecting a fresh fictional workbook in
hosted Development returned React error 441. Vercel logs for the accepted
deployment identify a null-prototype `tabIds` dictionary in the Server Action
response, digest `3207679980`. The metadata service now collects both tab
dictionaries without prototypes and returns ordinary objects through safe
object spreads. Two regressions fail before the change and all four metadata
tests pass afterward, including special tab names that must remain own keys.
The separate fictional workbook has four responses in each of its Fall and
Spring tabs. Drive Picker granted access, but the serialization failure stopped
selection before a new source was saved. Live retesting remains required.

Root PR #499 run `34310626588` found a stale private gitlink in the officer
runbook. The runbook and its release-state assertion now describe the verified
Production release and current candidate separately; all 13 focused contract
tests pass. A local full test run also timed out in two unchanged launcher
ownership tests. Keep these results distinct from the passing private suite.
The database replay and browser job in that run passed. The metadata fix passes
TypeScript and targeted zero-warning lint; it still needs integrated CI and live
verification. No extra hosted deployment ran for the documentation correction.

Resend has one enabled webhook per hosted environment and verified sending
domains. This is configuration evidence only. Production campaign dispatch and
signed settlement remain unproven. No test messages were sent to students.

### Current acceptance failures and fixes, 2026-09-08

The invitation repair is pushed at root
`72b690305cf799496c81bc9cd56fb0bf8948fd4a`, with private gitlink
`09c36d6750e5ce4685443c33df236111bee20177`. Its quality job in run
`34300350965` passes full tests, lint, TypeScript, and the build. Database checks
passed. The browser suite passed 88 tests and skipped four. The invitation
test reached its success heading and confirmed accepted status plus active
staff membership, then failed only in fixture cleanup. The retained trace
confirms that each assertion through line 111 passed. Deleting the parent
organization first caused its membership-removal trigger to reference the
deleted parent. The fixture now deletes only its scoped memberships before
deleting its organization. A focused regression failed before this change;
12 invitation and fixture-inventory tests pass afterward with 2,432 assertions.
A rolled-back Development probe confirms that the removal receipt exists while
the parent exists, then cascades away with the fictional organization. No
fixture remains from that probe. TypeScript, targeted zero-warning lint, and
strict private gitlink checks pass. This cleanup-only follow-up changes no
application bytes or Production database behavior. The hosted acceptance selector skipped
execution because this commit has no deployment marker. It is not a hosted
acceptance pass. No application deployment was requested.

Chrome became available again. The signed-in Riddhiman Production officer
session rechecked the chapter Google connection successfully, then used
Class of 2027 Settings to check the linked workbook revision. The saved result
reports "The class workbook is up to date." This is a metadata check, not a
new import commit or resolution of the remaining undocumented skipped row.

A fresh read-only Production comparison found that all 4,434 imported activity
entries match their saved commit payload's activity slot, exact label, and raw
points. All referenced source rows exist and their hashes match. All 1,392
attendance records retain the saved meeting key and exact label. Duplicate
groups are zero for profile/term/activity source slots, imported catalog source
keys, and profile/term/meeting keys. The first activity comparison incorrectly
looked for slots in the display record rather than the commit payload; the
corrected query proves the counts above. No data repair followed that diagnostic.
These checks do not establish fresh Drive-version parity or application imports.
Only two of the 736 active Production profiles have a nonempty normalized school
or personal contact email. This limits existing email-based matching and does
not authorize treating application response emails as verified account identity.
The count-only evidence is retained in ignored artifact
`.artifacts/csf/production-source-label-check-20260909.md`.

Root `65442bbb8cd71d5adbbdf10478f1ae0550b25604` passed the quality job in
`34298362402`, including full tests, lint, TypeScript, and the Production build.
Database replay and SQL checks passed. The browser suite passed 88 tests and
skipped four, but the invitation journey failed twice before sign-in. Fixture
creation now succeeds; the lookup still returns "Invitation Not Found".

The lookup joins the inviter's private `profiles` record. Anonymous users have
no SELECT permission there. A read-only Production transaction confirmed that
the valid-token invitation and organization are visible without that join.
The local repair removes the private embed and names only the organization in
the invitation UI. It changes no database grants. The focused regression failed
before the repair and passes after it; eight invitation/boundary tests pass
with 29 assertions. The fixture now includes its administrator membership.
The full recipient journey and hosted acceptance remain open.

September 9 count-only Production checks found 1,909 latest stored workbook
rows with exact successful receipts, including 150 pending and 166 superseded
rows that must not be blindly retried. One Class of 2027 Fall 2024 row is marked
skipped without an officer, reason, or resolution timestamp; it remains an
exception to review. Current Drive-version parity and repeat-sync proof remain
open. The latest stored application previews contain 588 rows with class and
semester targets, but Production still has zero imported applications.
Production's 460-version ledger is an exact ordered prefix of the candidate's
468 versions. Workbook/import workers are enabled on the existing public
release; communications and scheduled publishing are disabled. No CSF dispatch
attempts, verified provider events, unresolved webhook quarantine, or scheduled
posts exist in the Production count snapshot. No write or provider send ran
during these checks. The Mac remains locked.

Root `9f35cd4fa0ca3066958d02f0394d1eaeee409dc0` failed quality in run
`34296657950` because the new fictional invitation browser test was missing
from the organization-username fixture inventory. The local correction lists
that writer and validates its generated username through the existing product
schema. All five inventory tests pass with 2,409 assertions. This changes test
accounting only; it does not exempt the fixture or change application code.
The independent database job passed its replay and SQL checks. Its browser
suite passed 88 tests, including the previously failing Sheet controls, and
skipped four. The new invitation journey failed before browser actions because
its fixture used a hexadecimal organization code; the database requires six
digits. The test now uses the existing `fixtureJoinCode` generator. Recipient
acceptance remains unverified until that journey passes.

The corrected fixture and seed suites pass 37 tests with 2,743 assertions.
TypeScript, focused zero-warning lint, formatting, and the strict gitlink check
pass. The full local launcher stopped at 228 passing tests and six timeouts in
its existing Docker ownership/lifecycle suite. A read-only process check found
an unrelated Android emulator process consuming roughly eight CPU cores. That
process was left untouched; no timeout threshold or required test was relaxed.

Read-only Drive metadata checks on September 9 resolved all four stored class
workbook IDs. The connector omitted provider versions from its normalized
response, so this does not establish revision parity or completed imports.
The Fall 2023 application search and its source-folder listing found the late
responses Sheet, but not the main responses Sheet. Keep the main source as an
unresolved exception. No source contents or student identities enter this log.

Root `8e5f597ff09767c2fdc0325638a904f9fa4a0c02` contains the grouped
import and officer-loading fixes. Its quality job passed, including tests and
the Production build. Run `34294032753` passed database checks but failed
the new Sheet-control browser assertion twice: 87 browser tests passed, one
failed, and four skipped. The loaded consent checkbox exists, but the adjacent
action row has no layout box. The grid-only patch did not fix this. Private
PR #273 moves the actions outside the conditional field group and uses block
flow for the fieldset. The same browser assertion remains required. This push
did not request a hosted app build.

Private PR #273 passed quality run `34296252302` and merged as
`09c36d6750e5ce4685443c33df236111bee20177`, identical to tested candidate
`d51044ea7a953ecc1d8adebc01aa1ec99ac4e103`. The next root candidate combines
that layout correction with invitation-header repair and its browser test.
It still needs root browser and hosted acceptance; private CI is not that proof.

Live Production chapter-account setup reproduced an invitation defect. The
audited staff invitation was sent once, reached the chapter mailbox, and
remains pending. Google sign-in as the invited account succeeded, but its
invitation page returned "Invitation Not Found". The same link rendered for
the inviting administrator. A read-only transaction confirmed zero visible
invitation rows without the existing required request header and one with it.
No membership or position was assigned, and no invitation was resent.

The local repair passes the validated invitation token to a new request-scoped
client for both lookup and acceptance. Ordinary clients receive no capability;
cookies and the invited-email acceptance check remain intact. The initial
regression failed before the patch and passes afterward. An isolated browser
test covers anonymous lookup, malformed tokens, wrong-account refusal, and
recipient acceptance. Live acceptance still requires the grouped release.
Five token-client regressions and two action-boundary tests pass, with 27
assertions. Root TypeScript and full zero-warning lint pass. The chapter
invitation remains pending, and the Mac locked before further live work.

Private PR #272 passed CI `34292195862` and merged as
`43f3c6ba06f2ff60d2d4961415c01045f14291f3`, with the same tree as tested
`2fcefc588533d527e4326d26ef5c86697f636dd8`. All 303 private test files,
TypeScript, targeted zero-warning lint, and the strict root gitlink check pass.
The root candidate pins that merge. No follow-up app build has run yet.

Root zero-warning lint and the 40 documentation contract tests pass. The local
unit launcher reported 229 passing tests and five timeout failures in unchanged
fake-Docker lifecycle and ownership tests. Their child processes exceeded the
five- or fifteen-second limits. Docker Desktop also cannot start, so local
browser replay remains unavailable. These failures remain recorded; fresh CI
must verify the grouped candidate before release.

After the failed fictional queue lease expired, the existing queue RPC
reconciled its saved partial commit. A transaction checked the exact queue,
fictional organization, expired lease, and partial receipt first, and refused
any other running queue. The RPC returned `claimed=false`, `reconciled=true`,
and `status=blocked`. Readback still shows exactly 150 succeeded updates and
43 frozen rows. No member writes were repeated. The original failure remains
recorded, and all worker switches remain off.

Root PR #496 merged as `7ba7f07591d614a43fd52773cac2cc7d57729ade`,
pinning private `d9d227f12cc9a590c2d855cc2351fe4215ce1a9a`. Development
deployment `dpl_9qzEDJTgkLqamaX57UUvNbaASTCF` serves that source against
`ocbuygudvarsuxijxhau`. Development has 468 reviewed migrations. Production
remains unchanged at 460 migrations, with zero imported chapter applications
in the latest read-only check. Production PR #497 remains open.

Root `3b79895a37dd3881511885a50ba71148ee2551c7` changes acceptance tooling
only. It verifies unchanged application bytes before reusing the Development
build and selects the latest Supabase check for the exact Development project.
A later Production integration skip had hidden the earlier Development success.
The original run `34287702371` was canceled before load began. No additional
application build was requested for the tooling correction. Code quality and
database run `34288617524` passed for the corrected root revision.

Hosted acceptance `34288632216` failed its officer route budgets. It made 9,405
requests with zero errors and zero 5xx responses. Overall read p95/p99 were
1.73/3.38 seconds. Officer Classes p95/p99 were 2.60/5.68 seconds,
Applications 3.03/7.02, and Home 3.02/6.64. Mutation p95 was 1.34 seconds.
LCP p75 was 1.492 seconds, INP p75 32 ms, and CLS p75 0.0061. All 25 review
navigations passed, with no browser errors and retained heap down 11.6 percent.
These passing measurements do not cancel the route failures.

The fictional workbook recovery action queued refresh job
`ec2d8682-0ae9-419c-82f5-c3c1aedd0ce6`. Worker check `34288925560`
prepared four populated tabs and retained four templates with no blocked tabs.
The browser then approved three ready semester previews. Import check
`34291184181` failed after the first preview saved 150 successful row updates.
Its commit receipt `c96628be-b433-4101-95b1-ee5b8f75c486` records
`unresolved_outcome`; 43 rows remain frozen and the other two previews remain
queued. No automatic retry was made. All Development workers were disabled
again at runtime revision 4, receipt `ca6208a6-1fd6-40ee-90d5-de5368368429`.

The hosted database uses an eight-second statement limit. Recorded ten-row
batch executions reached 7.92 seconds. The follow-up reduces new batches to
five and reads only pending row identifiers. Existing unknown outcomes still
require receipt reconciliation; the smaller size does not authorize replay.
Officer Home also starts its shared snapshot without delaying independent
reads. Focused regressions pass, but hosted performance remains unproven.

The live Application Sheet dialog hid its update action row after loading.
Changing its existing shadcn FieldGroup to grid restored the layout. Private
PR #271 passed CI `34291274195` and merged as
`3b14a6d835da98fa28b96e25b80b1fb972463f77`, identical to tested `bbfcc3e`.
The root browser regression checks action visibility, consent, and reload
without enabling updates. Local browser replay is unavailable because Docker
Desktop cannot start; the grouped CI replay must run it before release.

### Production access and count-only recheck, 2026-09-08

Supabase dashboard access recovered. Turned off GitHub automatic branching,
saved the setting, and confirmed it remained off after reloading the project
integration page. The persistent Development branch was not removed. Vercel
credential syncing remained Production-only. The earlier push hold is cleared.
Published private commit `27245a321a63d2a180251294f2e829637aa0b387` in PR #270.
Private Plugin Quality run `34284459400` is running; GitGuardian passed.
No merge, application deployment, migration, or import commit occurred.

That private run has now passed every job. PR #270 merged as
`d9d227f12cc9a590c2d855cc2351fe4215ce1a9a`, with a tree identical to tested
`27245a3`. The root candidate now uses that merged checkout. Also submitted
the setting to disable direct GitHub main-merge Production database deployment,
so the reviewed forward-migration workflow remains the intended deployment
path. Its saved state still needs a full-page reload check before any main merge.

Reload verification now confirms both automatic branching and direct main-merge
Production database deployment are off. Root PR #496 advanced to
`feb27bfe471a24f3f267f9f941f429f682c414ed`, pinning private merge `d9d227f`.
Code quality and isolated database run `34284856406` is running for that root
candidate. Supabase Preview reported `SKIPPED` after the push, consistent with
the disabled automatic branching setting. No application release or academic
data write occurred. This evidence-only note does not request another build.

Run `34284856406` finished with two stale contract failures. The root suite had
one failure because the officer runbook still named ledger 466 and private
`ce8d607`; it now names ledger 468 and private `d9d227f`, and all 13 focused
documentation tests pass. Database replay applied the candidate and ran 259
files with 7,418 assertions, with one failure in the old direct merge-call
inspection. The corrected test checks the entire workbook-link wrapper to
private implementation to canonical preview chain, plus the implementation's
fixed search path and lack of service-role execution. All eight assertions pass
in a rollback-only Development transaction. An initial probe lacked the pgTAP
extension and aborted; the corrected probe created it inside the rollback.
Development still has 462 migrations and no temporary authorization table.
No application source or migration bytes changed in this correction. Full CI
must pass before the candidate proceeds to hosted acceptance.

Chrome is unlocked and the Riddhiman profile is accessible. Supabase's expired
dashboard session refreshed through GitHub and now requires the user's
two-factor code. This replaces the earlier locked-Mac blocker. Automatic PR
branch creation remains unverified and must be disabled before further pushes.
The connected database tool confirms only Production and persistent Development
exist. Production still has 460 migrations through `20260906085350`.

Read-only chapter counts show 347 directory profiles for 2027, 281 for 2028,
108 for 2029, and zero for 2030. These count active class-directory associations,
not current-semester membership or proof of complete source reconciliation.
Each class has one linked workbook with eight discovered tabs and matching
stored provider/prepared versions. Applications remain zero for every class,
including alumni 2026. No records, provider settings, or deployments changed.
A public status request returned HTTP 429, so it provides no current release-SHA
evidence. Root PR #496 remains open at `2bea7093`, with its earlier database
replay failure still recorded. The local fixes have not reached hosted CI.

### Open P1: matching semester tabs need explicit workbook consent

The source registration and preview paths currently enable updates per reviewed
tab. They prepare new tabs but do not carry consent to them. This leaves the
requested link-once behavior incomplete. Local forward migration
`20260908141739_csf_workbook_matching_tab_authorization.sql` adds opt-in matching-tab
scope and parent authorization references without expanding existing consent.
The old action signature still means one tab. The new scope has retry-bound
audit receipts, and inherited authority retains the original header signature,
officer, Google owner, and parent generation.

A Development rollback-only test passed 20 assertions for legacy behavior,
explicit scope, request replay, inheritance, changed point rules, parent pause,
independent child review, tenant isolation, and internal permissions. The first
fixture setup hit the existing mapping-version guard; corrected fixtures now
insert their reviewed mappings at creation instead of bypassing that guard.
After rollback, Development retained 462 migrations, no temporary authorization
table, and zero fixture organizations. No Production change occurred.

The officer control and validated workbook preview worker now use the explicit
matching-tab scope. Private local commit
`27245a321a63d2a180251294f2e829637aa0b387` on
`codex/csf-matching-semester-consent` contains the implementation and regression
tests. Existing controls still default to one tab; a scope change needs explicit
mapping confirmation and gets a scope-bound request identifier. Failed inherited
permission reads stop preparation instead of silently making a manual preview.
Headers still must match the original reviewed signature before sealing.

Verification now covers 31 matching-tab database assertions and 107 existing
authorization, workbook-check, class-preview, and class-commit assertions in
rollback-only Development transactions. The latter include preserved activity
labels, points, meeting links, and replay receipts. All 56 focused app tests and
all 303 private-plugin test files passed. Zero-warning lint and TypeScript passed.
The exact 468-version schema catalog passed; dropping the inherited-authority
tenant constraint made the catalog fail. The eight-file release controller pins
the migration at SHA-256
`c364e525e909d2f4c7213e45a0b18b39a337dcf744b9ceb0995a0fe8265d78d3`.
All 103 release-tool tests passed. Evidence logs:
`.artifacts/csf/matching-tab-private-tests.log`,
`.artifacts/csf/matching-tab-release-tests.log`,
`.artifacts/csf/matching-tab-lint.log`, and
`.artifacts/csf/matching-tab-typecheck.log`.

Release access recheck: Chrome again reported the Mac locked. Docker Desktop
again reported that it could not start. Root PR 496 still points to `2bea7093`;
its database CI failure is terminal and predates the local fixes. No release
CI job is running. Supabase lists only main and persistent Development, so the
deleted automatic PR branch has not returned. The local fix remains preserved
without another push. Further release work needs the unlocked officer browser
to disable automatic PR branching and perform the authorized live workflows.
Do not poll unrelated scheduled platform jobs as release progress.

Still required: publish and merge the private change, advance the root gitlink,
pass the full database and hosted gates on the final candidate, and verify the
signed-in officer flow. The root gitlink remains indexed at the previously
published plugin commit. No push, remote PR, deployment, or new hosted branch
was created for this follow-up. Do not claim workbook-wide updates are live.

### Open P1: reviewed workbook links need profile-merge ownership rules

Root CI `34234185743`, database job `102087553933`, replayed the candidate
schema but failed two of 7,375 pgTAP assertions across 257 files. The exact
profile-reference inventory found 32 columns instead of 31 and identified an
unclassified reference. The added
`csf_reviewed_workbook_profile_links.profile_id` needs an explicit canonical
merge policy. Do not fix this by increasing the expected count alone. An
audited officer merge must preserve the original review evidence, retain
revoked history, and keep active workbook lineage attached to the surviving
profile. Add a forward migration and transaction/replay tests before release.

Local forward migration `20260908135756_csf_reviewed_workbook_link_merge_ownership.sql`
now implements that ownership policy. Development rollback-only validation
passed all 12 new merge/link assertions and the 48-assertion reference-completeness
suite. These cover active ownership, unchanged revoked evidence, later source-key
reuse, original officer evidence, exact receipt replay, refusal without identity
evidence, and internal function permissions. The first fixture run correctly
refused a name-only merge; the test now retains that refusal case and supplies
matching fictional contact evidence for the successful merge case.

After both suites, Development still had 462 recorded migrations, no temporary
reviewed-link table, and zero fixture organizations. No Production changes,
pushes, builds, or new hosted branches occurred. This finding remains open until
the complete database gate passes on the final candidate. The release catalog
now pins all four merge/reference helper bodies, signatures, metadata, and
postgres-only execution. The exact 467-version catalog passed in a rolled-back
Development transaction. Granting the runtime role access to the internal merge
helper or changing reference-plan volatility both made the check fail. A final
read confirmed the original 462-version ledger and absence of the test table.
The controller pins the seven-file tail after Production's 460-version prefix,
including SHA-256 `da88367fb65b095f2206718c156ded7e4c40073ebbf410546ff2b2e868b2e342`
for the new migration. All 31 focused release/catalog tests passed. The broader
release-tool suite then passed 102 tests across 13 files with 603 assertions.
Zero-warning lint, TypeScript, migration-file validation, and strict private
gitlink checks passed. Logs are `.artifacts/csf/merge-link-release-tests.log`,
`.artifacts/csf/merge-link-lint.log`, `.artifacts/csf/merge-link-typecheck.log`,
and `.artifacts/csf/merge-link-migration-validation.log`. These checks do not
replace full isolated database replay or hosted application acceptance.
The Mac still reports locked, so officer
actions and disabling automatic Supabase PR branching remain unavailable.

The same run passed the 1,000-row automatic application database test in
172.366 seconds: 17.290 seconds for applicant preparation and 155.076 seconds
for commits plus batch replay. Assertions prove 1,000 applications, 1,000
successful row receipts, 20 batch receipts, zero duplicate row outcomes, zero
approvals or manufactured semester memberships, two retained uncertain rows,
and no unresolved write outcomes in the successful case. This is database-only
scale proof, not Google/browser/worker end-to-end proof. The failure log is
`.artifacts/csf/root-candidate-database-ci.log`. The failed database gate stops
the later workflow/browser checks; no passing overall acceptance is claimed.

### Application Sheet dialog follow-up, 2026-09-07

The September 8 workbook continuation fixed an early return in semester
preparation. A term with unresolved prior write outcomes is no longer rebuilt
and no longer prevents later terms from preparing. A preview that explicitly
returns a known blocked result also remains a per-term exception. Unknown or
retryable publication results and expired worker authority still stop the
generation. The completed preparation cycle reports `blockedTermCodes` beside
`preparedTermCodes`; the worker stores blocked, prepared, and template counts
separately. Completion here means the preparation cycle ended, not that every
source row imported or every term passed review.

Five behavioral tests cover independent terms and stop conditions. Eighteen
worker-route tests and six linking contracts also pass, totaling 126 assertions.
Five rollback-only Development database checks confirm that the existing worker
receipt can retain both prepared and blocked counts while recording the exact
completed generation. This does not create semester memberships. TypeScript,
targeted zero-warning lint, formatting, and diff whitespace checks pass. No
database migration was needed for this fix. Chrome was checked again and still
reported the Mac locked. The automatic-consent integration, official imports,
and live officer workflows remain unfinished; no deployment occurred.

The September 8 release-catalog follow-up accepts only the exact local
466-migration sequence, with ledger SHA-256
`b7935dfecb07b70ca0f07b577af5d218f56a7d54e2c17b4a9385448d6f3b720d`.
It pins all 19 automatic-update functions, including their complete definitions,
owners, explicit grants, execution properties, and body hashes. It also checks
the three authorization/approval tables and the unique authorization receipt
index. Earlier accepted catalogs keep their preceding requirements.

Twenty-two catalog unit tests and targeted zero-warning lint pass. Rollback-only
Development checks accepted the exact new catalog, refused an added browser
execution grant and a direct runtime authorization-table write grant, accepted
the restored grants, and refused a missing receipt index. The complete release
catalog then returned `csf_target_schema_verified=1` with all four pending forward
migrations present in the same rolled-back transaction. This proves candidate
catalog compatibility, not an applied migration, completed replay, or deployed
application. No CI deployment was triggered. Class-workbook automatic updates,
the full scale run, official imports, and live acceptance remain unfinished.

Historical applications remain part of the release scope across all classes,
including alumni. A fresh count-only Production check on September 8 found one
matching chapter and zero imported applications. This is still unfinished data
work. No Production records were changed during the check.

The local application transaction now has 12 passing database checks, including
profile preparation, safe-row approval, source evidence, attempt claim, batch
commit, lost-response replay, and finalization. One application is saved once,
with one batch and row receipt. It grants neither application approval nor
semester membership. Two uncertain siblings remain visible, and finalization
correctly reports partial completion with no unknown write outcome. Preparation
also requires consistent normalized names and an existing class-term binding.
Its 22 checks and the 12 fifty-row batching checks pass after these changes.

A 100-application diagnostic passed all 11 assertions in 4.656 seconds, including
batch replay. The 1,000-application test exceeded the connector response window
twice and is not accepted evidence. Query profiling found that the candidate
selector evaluated all 1,002 rows before returning 50, taking 32.203 seconds.
The local query now checks locked candidates inside its loop and stops after 50
successful preparations. Creating the first 50 profiles from the same size
fixture then took 2.026 seconds. Identity checks, audit calls, locks, and the
per-call creation limit remain in place. The full 1,000-row test is retained for
the database release runner, with preparation and commit timings reported
separately. Docker Desktop could not start, so no full local replay was claimed.

The historical layout, application lineage, and review-period suites pass 48
tests with 115 assertions. They cover Fall 2023 through Spring 2026 class
mapping, alumni, blank leading columns, source-semester preservation, course
corrections, and closed review periods. Migration filename validation and diff
whitespace checks pass, with 67 unchanged historical description warnings.
Every database experiment rolled back. The final check found no test schema,
function, or fictional tenant; Development still has 462 applied migrations.
Chrome still reported a locked Mac. Live officer actions, official imports,
class-workbook automation, release catalog review, and full hosted acceptance
remain open. No commit, push, deployment, or migration application occurred.

New-applicant preparation is now implemented locally. The saved source consent
must still be current, and its authorizing officer needs profile-management
permission as well as import access. Each database call creates at most 50
unclaimed profiles through the existing audited profile and reconciliation
functions. Complete names, valid targets, no current name/contact candidate,
no conflicting sibling response, and settled source evidence are required.
Form emails remain evidence rather than canonical identity. The transaction
makes no application decision or semester membership. An existing safe-row
approval cannot acquire new targets from a later call.

The worker runs bounded preparation before queue approval. Lost responses remain
unknown and do not trigger another call in the same run. Larger preparations
remain due for a later run. The existing source-evidence validator is shared
through an owner-only helper; normal claim callers cannot opt out of unresolved
row checks. Twenty new-applicant checks, 12 batch checks, the prior 51 consent
checks, and 14 safe-scope checks pass in rollback-only Development transactions.
The batch fixture creates 50 applicants, then one, then zero on replay, with 51
creation receipts and one frozen approval. The processor passes 20 tests with
66 assertions. TypeScript, zero-warning lint, and all 292 private-plugin test
files pass. Development remains at 462 migrations; the local tables/functions
and fictional tenant were confirmed absent after rollback. No Production
mutation or deployment occurred. Full row-commit replay, the 1,000-row timing
test, class-workbook automation, catalog review, and live acceptance remain open.

Application retry review found a separate repeat-sync gap. Form addresses remain
unverified evidence, so a changed application source could send an already
imported record back to name review. The local worker now supplies the previous
preview for retry checks. A preview retry must retain its provider file identity.
Application reuse requires a successful same-source receipt, the same class and
semester, one current candidate, active class membership, and unchanged name,
contact, grade, and submission-time evidence. The preview records source lineage
rather than email verification. An unchanged row cannot be skipped after its
target class or semester changes.

The reader follows unchanged receipts back to their successful application
origin with tenant-scoped reads, 200-ID query batches, and a 32-step limit.
Missing ancestors, changed hashes or targets, foreign files, cycles, conflicting
profile decisions, and attempted or unknown writes do not prove identity.
Forty-six focused tests pass with 125 assertions. TypeScript, zero-warning lint,
and all 292 private-plugin test files pass on the final local changes. No new
migration or Production change occurred. Automatic new-profile creation remains
unfinished; this change only preserves an established imported profile.

The existing workbook refresh route now also checks due application sources,
behind its existing authentication and workbook disable switch. Class and
application processing settle independently. Responses contain counts and
closed status values, and unknown application outcomes return 503 without
hiding class outcomes. No new cron schedule or enabled worker was added.

The application Sheet dialog now exposes explicit enable and pause controls for
a sealed native Google application preview. Enable requires an unchecked mapping
confirmation and the exact reviewed preview ID and version. Old sources remain
manual. The control shows the saved result, blocks double clicks, checks unknown
outcomes before retrying, preserves the request ID for that retry, and ignores
responses from a previous selection. Pause does not alter imported records.
Class-workbook automatic controls remain hidden until their worker integration
is complete.

Thirty-two focused route, control, and dialog tests pass with 101 assertions.
TypeScript, zero-warning lint, and all 290 private-plugin test files pass.
These are local results. Historical applications for every available chapter
source, including alumni, remain in scope but are not yet reconciled in
Production. The Mac still reports locked. No official import, migration,
deployment, or Production mutation occurred. Automatic new-identity creation,
class-workbook integration, the release catalog, full replay, and live acceptance
remain open.

Safe-row queue integration is now implemented locally. A source-authorized
approval records ready row IDs and their source, payload, profile, class, and
semester coordinates. The existing claim and queue gates allow unresolved
siblings only when that approval still matches every pending row. Source,
snapshot, target, and unknown-outcome checks remain in place. Later-resolved
rows cannot join a saved approval. Queue retries use the preview's stable request
ID and retain one batch receipt and one officer-attributed audit event.

The application refresh processor now queues a preview after its preparation
checkpoint settles. Unchanged revisions can recover a missed queue request
without parsing again. The commit action reads the database approval before
allowing unresolved siblings; malformed or lost approval receipts do not permit
a claim. The new 14-check rollback test queues one fictional ready application
beside two uncertain rows, confirms retry receipts, and rejects scope expansion.
The preceding 51 authorization checks also pass. TypeScript, zero-warning lint,
66 readiness tests, 15 processor tests, and all 289 private-plugin test files
pass. These checks do not yet prove a complete live import. The recurring worker
entry point, enable/pause UI, automatic new-identity creation, class-workbook
integration, release catalog update, and full database replay remain open.
No migration, application deployment, or Production data change occurred.

The local automatic-update migration now checks saved source consent at commit
claim, row begin, and row commit. Each boundary retains its actor, identity,
immutable payload, and retry checks. Automatic previews also require the current
authorization generation, actor, prepared checkpoint, provider version, mapping,
read scope, and approved headers. The staff lock precedes the identity lock;
source authorization stays locked through the write so Pause cannot race it.
Manual previews retain their existing approval path. Fifty-one rollback-only
database checks pass, including direct claim and row-entry refusals after Pause.
All 288 private-plugin test files pass. Migration format validation passes with
67 historical comment warnings; full database replay was not run. The new schema
and fictional tenant were confirmed absent after rollback. Production remains
unchanged. Safe-row selection, automatic queue integration, live reconciliation,
and release acceptance are still open. Chrome remains locked on the latest check.

Historical application scope includes every available chapter source and alumni,
with each response kept in its source semester. A focused local rerun passed
41 tests and 104 assertions for historical class routing from Fall 2023 through
Spring 2026, current mixed-class responses, review-period handling, reported
totals, and automatic read ranges. A new regression first reproduced an invalid
header outside the officer-reviewed range. Automatic range expansion now refuses
that mapping even if the provider grid has grown. These are local checks, not
evidence that historical applications have been imported into Production.

Automatic-update continuation: the current refresh worker accepts only class
workbooks, and the existing batch/commit guards reject an entire preview when
any sibling needs review. T47 therefore requires both a source worker path and
an explicit safe-row commit scope. Do not remove the existing whole-preview
guards and call that automatic reconciliation.

Local migration `20260908090508` now defines source-scoped automatic-update
authorization. It records the approving officer, separate Google connection
owner, file, source kind, exact mapping hash/version, generation, and status.
Old sources receive no authorization. Explicit pause invalidates a lease even
if the source mapping changed. Request receipts prevent an old enable retry
from undoing pause. Both the approving officer and Google owner need current
import authority when updates are enabled. Direct runtime writes and browser
reads of this table are denied.

Twenty-three rollback-only database tests passed against Development. They cover
permissions, absent default authorization, stale mapping refusal, request
replay, changed intent, pause, lease invalidation, due checks, unchanged revisions,
and no application writes. The migration remains local.
The exact release catalog still accepts only the preceding 465-version
candidate, so this new 466-version candidate intentionally cannot release
until its worker integration and catalog review are complete. No deployment
or Production mutation occurred.

The next local continuation connected application preview preparation to the
automatic-source lease validator. It derives the approving officer and separate
Google owner from the database receipt, refuses class-workbook jobs on this path,
and rechecks the source after loading. Acquisition must match the expected file
and exact provider revision. Checks run before acquisition and preview writes.
The immutable preview records the authorization generation, without its secret
or lease token. These application checks do not replace the database checks
required before automatic row commits.

Eleven new focused tests passed with 67 assertions. TypeScript, full zero-warning
lint, and all 285 private-plugin test files passed. Existing class refresh and
manual officer authorization paths remain intact. The due-source controller,
growing-tab ranges, explicit enable/pause UI, and safe-row commit scope remain
unfinished. No new worker is enabled. The Mac still reports locked, so no live
officer action or Production data change occurred in this continuation.

The following continuation added guarded enable/pause and status Server Actions.
Enable requires explicit mapping confirmation and a stable request ID. The actor
comes from the staff session. Reads expose status and mapping version, not worker
leases or Google credentials. Replaying an old enable request reports a later
pause truthfully. Nine action tests passed with 30 assertions, and the 36 server
boundary tests passed with 573 assertions. These controls are not yet wired into
the officer UI.

Review found that the new worker could label its first check unchanged without
ever preparing a preview. Local migration `20260908090508` now refuses that state.
Prepared results must match the source, mapping, authorization generation, and
exact provider revision in immutable preview evidence. Reauthorizing a source
clears its old prepared checkpoint. The revised suite passed 32 rollback-only
database checks, including revoked-authority worker refusal. A separate read
confirmed that neither the new table nor the fictional tenant persisted.
TypeScript, full zero-warning lint, and all 286 private-plugin test files passed.
No migration, deployment, or Production write ran.

The safe-row commit boundary remains unfinished. The existing claim calls
`csf_import_preview_claim_blockers`, which checks complete source evidence and
also refuses unresolved siblings. The existing freeze selects pending rows;
resumes require those exact frozen decisions. A new explicit safe-row scope must
preserve evidence, unknown-outcome, snapshot-count, and frozen-decision checks,
then recheck source consent both at claim time and before row writes. Merely
removing the unresolved-count check from the action or query is not sufficient.

The next continuation added the application-source preparation processor. It
claims one due application source, uses the approved Google owner's purpose-bound
token, and reads only Drive metadata for an unchanged prepared revision. Changed
revisions use the authorized preview action. A lost settlement response reads the
same saved checkpoint instead of repeating preparation. Missing OAuth requests
reconnection; temporary metadata failure stays retryable. Results contain counts
and states, not source content. The processor is not connected to a cron route
until safe-row approval and commit wiring are complete.

The claim RPC now accepts a closed source-kind filter, so an application worker
cannot consume class-workbook authorizations. Its default preserves the existing
application test calls. Thirty-four rollback-only database checks passed.
The processor's 12 focused tests passed with 42 assertions. TypeScript, full
zero-warning lint, and all 287 private-plugin test files passed.
Growing-tab ranges and approved-header drift checks remain necessary before
automatic commits can run. No Production change or deployment occurred.

The next continuation bound source authorization to an explicit reviewed preview
and its header signature. The enable action now requires that preview ID, and
the database checks its source and mapping version. Pause still needs no preview.
The authorization and preview record the scope as future rows in the selected
columns and tabs. Existing sources receive no automatic permission.

Application refresh now reads the current tab dimensions and extends the selected
row ranges without changing their starting column, header, semester, or class
strategy. Missing tabs, removed columns, and oversized reads stop preparation.
The whole automatic read remains bounded. The preview compares current headers
with the approved signature before creating a preview job. Changed headers
produce a blocked mapping result; a metadata-read failure before preview creation
remains retryable. Database settlement independently refuses changed headers.

Thirty-seven rollback-only database checks passed. TypeScript and full
zero-warning lint passed after correcting a test-fixture type annotation.
All 288 private-plugin test files passed on this tree. The due
processor, controls, and safe-row commit path are still not connected to live
processing. No migration or Production mutation was applied.

Cross-semester identity follow-up: local migration `20260908084338` stores an
explicit officer-reviewed workbook/class/key-to-profile link. It changes no
existing links. Confirmation locks the preview before its row, rechecks the
officer and source lineage, and uses the existing audited row decision.
Future reuse still requires a consistent immutable source name, no contact
conflict, an active profile/class relationship, and the currently linked workbook.
Revocation preserves the original link and audit receipt. A replay reports the
saved link's current status and cannot reactivate a revoked decision.

The class review control has an unchecked option to reuse confirmed workbook
matches in later semesters. Each row gets a stable request derived from the
form request and row ID. Changed previews remount the form. Ordinary legacy
confirmation does not grant future reuse. Seventeen rollback-only database
tests passed, followed by 21 focused private tests with 131 assertions.
TypeScript and targeted zero-warning lint passed. A read confirmed the test
table and fictional organization did not persist. No migration was applied.
The officer revocation UI, broader conflict tests, exact release catalog update,
full replay, and live cross-semester recovery remain unfinished. This is not
the ongoing source-update authorization required by T47.

The next continuation added a protected Saved workbook matches panel. It reads
only on officer request, pages 25 active links from the class's current file,
and loads names only for that page. Revocation requires a reason and reports
success only after the database returns the matching revoked-link receipt.
Nine action tests passed with 26 assertions; the 36 authorization-boundary
tests passed with 569 assertions. The UI and actions are local, not live proof.

The database suite now passes 22 rollback-only checks, including conflicting
contact evidence, colliding immutable names, cross-organization access, blocked
workbooks, and archived class membership. An initial fixture used an unsupported
membership status; it now uses the schema's archived state. The release catalog
supports the exact 465-version candidate and pins all three function bodies,
argument names, grants, the complete link-table fingerprint, and request-receipt
index. Its 19 tests passed. Applying the three local function/table definitions
inside one rollback transaction returned `csf_target_schema_verified=1`.
TypeScript, full zero-warning lint, and all 283 private-plugin test files passed.
The Mac remains locked. Production officer actions, full database replay,
current-tree hosted acceptance, and ongoing source-update authorization remain
open. No hosted build or Production mutation ran in this continuation.

Historical application follow-up on 2026-09-08: read-only Drive inspection
confirmed the original response headers for late Fall 2023, Spring 2024,
Fall 2024, Spring 2025, and Fall 2025. Their populated timestamp counts were
50, 646, 764, 583, and 601 respectively. These are source counts, not unique
applicants or committed applications. Fall 2024 has a blank leading column.
Copied response tabs and separate decision lists are not additional responses.
The user-linked Fall 2026 source has 149 timestamped responses in its current
250-row grid. The other same-title workbook has zero timestamped responses.
Spring 2026 metadata and late Spring 2024 metadata did not return successfully;
their live source coverage remains unverified.

A fictional regression reproduced the analyzer selecting a copied response tab
when it appeared before the original. The local fix excludes a copy from
automatic selection only when its matching original has recognized application
headers. A source containing only a copy remains usable. Historical grade-to-class
tests cover Fall 2023 through Spring 2026, including alumni; a separate test
checks the blank leading column. All 42 analysis/layout tests passed with 129
assertions. TypeScript and targeted zero-warning lint passed. This fix is local,
with no new deployment or Production import.

Recovery follow-up on 2026-09-08: the new forward migration
`20260908075029` adds an audited request that stops only unstarted queued
imports for the exact linked workbook and requests a fresh review. Running,
attempted, leased, and unknown-outcome work refuses recovery. Existing source
rows and completed or failed receipts remain unchanged. A stopped preview
becomes retry lineage rather than an editable original. The Settings control
requires explicit recovery intent and retains its request ID on transport failure.

The rollback-only Development database run passed 19 pgTAP checks. Initial
fixture failures correctly enforced the outcome transition and missing-note
constraints; the test now uses a valid historical-unknown fixture. A post-error
read confirmed no test function or organization persisted. This did not apply
a migration or alter Production. Twenty-five focused private tests passed with
76 assertions, 17 release-catalog tests passed, TypeScript passed, and full
zero-warning lint passed. Full replay, current-tree hosted acceptance, and the
live recovery journey remain open. No new deployment was triggered.

Application-link follow-up: migration `20260908081328` prepares missing
membership-application review periods from the saved chapter source and exact
mapping version. It requires import and review-period permissions under the
staff authority lock. Existing periods remain unchanged, including closed
periods. The modal submits explicit setup intent; legacy source saves do not.
A failed setup reports that the source was saved without claiming the review
opened. No response is imported or approved by this operation.

Fifteen rollback-only Development database tests and nine service/contract
tests passed. The release catalog passed 18 tests and verified both candidate
functions, their exact bodies, argument names, owner, and server-only grants
against Development inside a rollback transaction. The schema check returned
`csf_target_schema_verified=1`. Follow-up reads confirmed both test functions
were absent and zero test organizations remained. TypeScript and full
zero-warning lint passed after this change. These are test results, not applied
migrations or hosted application acceptance.

The private-plugin suite then passed all 281 test files in isolated mock
processes. No tests failed. Both root and private diffs pass whitespace checks.
The two forward migrations remain local, and Production application counts
remain unverified beyond the zero-import audit above.
The final presentation adjustment shows recovery only after a blocked import,
not for every ordinary queued import, and uses source-neutral unchanged copy.
Its 28 focused tests passed with 78 assertions.

Chrome reported the Mac locked while checking the chapter invitation controls.
No invitation, membership, role change, or Production import was submitted.
Unlock was requested once; independent implementation continued.

The current Production count-only read still reports zero term applications.
The chapter account exists, but it has no organization membership. One active
staff position is assigned. The requested overall chapter admin access,
individual officer roles, historical application imports, and Fall 2026 imports
remain acceptance work. Account existence does not establish chapter authority.

Continuation on 2026-09-08: the signed-in fictional class Settings view exposes
the failed S25 rows only with generic Skip row controls. Its unique-match action
loads ambiguous rows from a needs_resolution preview, so it does not repair the
frozen deterministic failures. F25 and S26 still show queued work alongside
new identity-review requirements. Do not use those controls as evidence of a
working recovery journey, skip required records, or blindly run the remaining
queues. The reviewed recovery path and explicit cross-semester identity binding
remain release blockers.

Two local fixes now cover additional failures in that view. Batch approval sends
a client-generated request ID that stays stable across retries for the same
class and sorted preview set; changing that scope remounts the form with a new
request. Before hydration establishes the request ID, approval is disabled.
The existing server action and durable database batch receipt remain unchanged.
The displayed blocker count no longer counts a failed error row a second time
for needing a recovery decision. Its regression reproduced 258 for 129 rows,
then passed at 129 while approval remained blocked. Twelve focused workbook
tests pass with 41 assertions. The private-plugin runner passed all 280 test
files before the final count-only fix; that final fix passed focused regressions.
These are local changes, not a new deployment or completed automatic syncing.

Continuation after the approved automatic-update plan: hosted acceptance
`34191905027` passed for Development application `90cdcbcd`. Tooling PR #495
passed CI `34193474885` and merged as `e4a2a01143fdf02029ff5be52758022f2d568eec`
without an application deployment marker. The accepted app remains separate
from the uncommitted private UI corrections.

The local application review reader now projects only
`application_data.normalizedImport.claimedTotals` for reported point totals.
It no longer labels operative credit fields as student reports. A regression
first reproduced 2 instead of the reported 5, then passed with the corrected
projection. Missing or malformed claims remain null; explicit zero remains zero.
The header says Point total not provided when absent. Five reader tests and
28 totals/import-boundary tests pass. TypeScript and targeted zero-warning lint
pass. These changes have not been deployed or verified in the hosted UI.

The local Sheet form collapses a recognized semester into an editable summary.
Unknown or unconfigured semesters still require an explicit choice, never the
review filter's value. Twenty-one focused UI contracts pass with 72 assertions,
including the existing chapter-wide modal and no-change preview corrections.

Fictional batch run `34195488037` stopped at the second preview. F24 created
163 rows successfully on attempt one. S25 recorded 129 deterministic
`constraint_refused` failures, no successful rows, and queue status blocked.
All 129 rows lack contact data and currently require source-key review; the
automatic source-key resolver returns no target for all 129. F25 and S26 retain
360 untouched pending rows. No automatic retry or later worker invocation ran.
This exposes a batch dependency: a later preview was prepared before an earlier
semester established its profiles, then became identity-blocked at commit.
Do not relax name-only matching or mark this workbook acceptance complete.
The next implementation must surface these dependencies for officer review and
reuse only an explicitly authorized source-to-profile binding across semesters.

Development controls for `90cdcbcd` returned to revision 8 with all workers
disabled through receipt `69004d72-efbe-4e71-ac0c-9f6643820d94`. The controlled
enable used receipts `fa63b2f9-6945-4b18-9024-b0b09ca1cc0d`,
`fe1dac48-1f2c-48f6-9934-7413f7f94940`, and
`155b5b64-1475-4db1-96fc-7e934250cc53` in one transaction, leaving only imports
enabled during the test. No Production state or real student records changed.
Automatic-update authorization, review-period creation at linking, official
application reconciliation, and final Production acceptance remain unfinished.

The fictional class Settings batch action queued all four ready semester
previews together: F24 163, S25 129, F25 193, and S26 167 rows. Empty future
tabs produced no queues. Frozen receipt pairs in claim order are
`0d9c15ed-7b1f-46ac-86d4-c1817fd2d617` / `20987e0e-69a9-4314-9cf6-2e09782edb87`,
`43cdfeec-b0ea-44e2-93a3-44b1336def74` / `218c11c0-d6fb-4d0c-8dd8-898311aa303d`,
`6304f142-7fd0-4977-9b21-f15cb27d9831` / `56cabdc9-9a41-4773-a5aa-808f334ea151`,
and `982095ef-34be-4521-83ac-8093d9376f22` / `8d8d5e30-a449-4d14-9040-eab1e4a4ec2c`.
All remain untouched, attempt zero, with workers disabled.

The local Development verifier now accepts a frozen list of up to eight
fictional receipts and 1,000 total rows. Before each worker call it checks every
remaining queue, source, preview, and claim order. It advances only after the
previous HTTP response and every row receipt confirm completion. A lost
response or unresolved result stops the batch without another call. All 15
verifier tests pass with 126 assertions; targeted zero-warning lint passes.
The verifier change is not published yet, so the 652-row live commit remains
pending. This is test tooling, not a change to the application import worker.

Fictional Spring commit run `34192368538` passed on Development `90cdcbcd`:
authenticated HTTP response, verified receipt, four completed rows, no response
recovery. Queue `6f1f1177-90d4-4785-b213-64756869ab58` completed on attempt one
without an error. Each of Classes 2026, 2027, 2028, and 2029 has one created
application row in S26. The rendered result survives reload and shows four
created, zero updated, unresolved, or failed rows. The import worker was disabled
afterward through receipt `0a824efb-0419-47a7-b9ea-e4c229023148`; revision four
has every worker disabled. No Production state changed.

The saved source's Preview action then prepared unchanged Spring preview
`d4d0e844-f65b-4ab3-b408-0f5fd67e3cbb`. All four rows are superseded, with no
ready rows or new commit. P2: the UI incorrectly presents this successful no-op
as "Preview ready to verify" and "Import blocked. No ready rows remain in this
preview", with Existing zero. It should present an already-current state and
include settled prior rows in its existing count without enabling another
commit. Keep true identity/source blockers separate from this no-op state.
The local presentation correction now shows Already up to date only for a
sealed, nonempty, entirely superseded preview with no commit or recovery work
and no blocker other than zero pending rows. Existing counts use the whole
preview's committed plus superseded totals instead of parse-time profile-match
summaries. Commit blockers and server actions are unchanged; the button remains
disabled. Eighty-five focused tests pass with 325 assertions, along with
TypeScript and full zero-warning lint. These edits remain local on the reused
private review branch; no follow-up deployment was requested.

Root CI `34190860719` passed on
`af9be274631a332309862bcf9b690a8bd79369f3`: quality, database replay, scale checks,
88 CSF browser tests, and three DV browser tests. Four documented optional or
retired cases remain skipped; this run reports no flaky browser result. Existing
PR #494 merged to Development at `90cdcbcd38ee282f0f127fd170bc38b9cce4e0d1` with
an identical tree and private gitlink `b2b9339`. The release marker started
hosted acceptance `34191905027` and Development provider check `34191904207`.
Neither a READY deployment nor hosted acceptance has been verified for this
SHA yet. No Production promotion or additional application build was requested.

Development deployment status subsequently passed for `90cdcbcd`; provider
check `34191904207` passed and hosted acceptance reached its load run. The
signed-in fictional tenant now renders the Application Sheet modal and the
saved Spring preview as ready. Disabled import-worker check `34192142018`
passed with `authenticated: true`, `receiptVerified: false`, and zero completed
rows. It verified the exact served SHA and all workers disabled.

Clicking Add applications once created audited queue
`6f1f1177-90d4-4785-b213-64756869ab58` for fictional Spring preview
`39f20e7a-62a5-4145-b730-a5b543c2a26b`, source
`f2eabc7f-2056-4864-8ec6-76608746f26a`, four rows. The UI displayed an explicit
queued receipt. The database reports this as the only active import queue,
with zero attempts and no error. Worker controls for this SHA remain revision
zero, all disabled. No applications have been committed by this action and
the officer approval state has not changed. The one-shot commit check remains
the next acceptance step.

Production count-only recheck on 2026-09-07: the latest class-history previews
contain 1,743 successful rows, 166 superseded rows, and one skipped row. Every
superseded row has a successful receipt matching organization, source, tab,
row number, and immutable row hash. Thus 1,909 source rows have exact successful
receipt coverage across Class of 2027 (1,107), 2028 (652), and 2029 (150).
These counts are source rows, not unique profiles or active memberships. Empty
Class of 2030 tabs add no rows. This check did not repeat sync or resolve the
remaining skip, and does not prove unchanged-source idempotency.
The skipped Class of 2027 Fall 2024 row has no reason code, notes, or officer
resolution receipt. It remains an explicit exception requiring protected
source review, not an accepted intentional skip.
The same read-only audit counts 4,434 activity events, all with nonempty labels
and catalog links in the same organization and term. No duplicate non-null
catalog source identity keys exist within an organization and term. This checks
current relationships, not equality against a fresh Drive snapshot.
The signed-in Production Class of 2027 Settings page exposes completed term
counts but no review action for this historical skipped row. The current source
has an audited `skipCsfSheetImportRowAction` requiring a reason, but Settings
selects review rows from unresolved/error counts. Do not use duplicate
consolidation or reimport successful rows to manufacture a skip receipt. The
officer exception path still needs verification before closing this item.

The latest saved application previews still contain 588 rows: Spring 2026 has
517 and Fall 2026 has 71. Of these, 585 are ambiguous, two have conflicts, and
one is pending; none has started a commit. Source semester and class mappings
remain separate, including 85 Spring alumni rows for Class of 2026. The current
Drive revision still needs comparison before these saved previews can support
an officer commit. No Production write occurred during this audit.

The final combined local run passes across 306 root and 307 plugin test files
with private merge `b2b9339`, including the saved-tab recheck guard. Full lint,
TypeScript, strict gitlink validation, and all 21 operator documentation checks
pass. The existing root PR will carry this integration and the officer-tour
navigation test correction together. Hosted acceptance is still pending.

P2, saved-preview recheck scope, local fix awaiting integration: `import-preview.ts` built ranges from
the saved source's current mapping before loading `retryOfJobId`. That later
check validates organization, source ID, and preview mode, but not the saved
preview's tab scope. Switching one application workbook from Fall to Spring
can therefore make Recheck on its older Fall preview read the Spring tab.
A new pre-acquisition scope check rejects changed tabs, missing saved scope,
and unrelated history. Corrections within the same tab remain allowed.
Sixteen focused retry and targeting tests pass with 51 assertions, as do
TypeScript, full zero-warning lint, and all 278 private-plugin test files.
Private commit `e92f59b49e81396a9bfcd2baf45ceecca5579f66` is under PR #268,
whose CI `34190350981` passed. PR #268 merged to private Development at
`b2b933917f1b41a5bd90d7fc7c613d9ca26b86bb`, with the tested tree unchanged.
Root integration and hosted acceptance remain open. No live mismatched retry
was invoked in this audit.

Root CI `34189124828` passed quality and database/browser acceptance on
`1b530a27df74f310684cee5bd0bfd39a2fd26c90`. This result covers the dialog
test corrections but not the later tab-scope guard or pending officer-tour
test correction. CSF reported 87 passed, four skips, and the same Communications
menu test passing only on retry; DV reported three passed. No Development
application build has been requested yet.

Fresh Development reads confirm the fictional workbook's four corrected
previews have 652 pending rows and no row errors: F24 163, S25 129, F25 193,
and S26 167. The four older error previews remain history. Both fictional
application previews have four resolved rows and four distinct profile targets.
No application or class row was committed in this read-only check. The nine
one-shot import verifier tests pass with 66 assertions, including foreign or
already-attempted queue refusal and lost-response receipt recovery without
another worker call. Hosted worker authentication and commit proof remain open.

The retained Communications failure screenshot shows the first-login officer
tour overlay covering the More menu. The navigation test now explicitly opens
and dismisses that tour before using More, following the existing member tour
journey pattern. It does not force clicks through overlays or bypass the menu.
This correction still needs browser execution. The retained application
screenshot confirms the new dialog rendered in isolated CI on `1bfa2820`,
not hosted Development or Production. Its deliberately incomplete preview
correctly keeps Add applications disabled.

CI `34187885325` ended with 85 browser tests passing, two failures in the old
application button and collapsed saved-preview selectors, one Communications
navigation failure that passed on retry, and four skips. The two deterministic
failures match the corrected browser journeys below. Retain the Communications
retry as an intermittent failure, not a clean first-pass result. The full
quality job and database steps passed; browser acceptance remains open.

The browser source still expected the old "Import responses" button and
"Resolve rows" headings. Updated journeys now exercise "Link Google Sheet",
dialog close/reopen and Escape, collapsed previous checks, full-preview counts,
and saved row paging across reloads. TypeScript and targeted zero-warning lint
pass. These test changes have not passed a browser run yet. The current CI run
remains active and was not restarted for an observation timeout.

Root candidate `1bfa282089aeaf8d7aed4de575faf8cf6427cab2` passed the quality
job in CI `34187885325`, including lint, TypeScript, combined tests, and the
Production build. Database replay, CSF database workflows, scale checks, and
DV browser checks passed their steps. CSF browser checks are still running.
No hosted application deployment or Production promotion occurred.

The signed-in officer browser on Development `8a48f7a1` completed the four-row
fictional Spring application reconciliation. Three audited matches reuse
profiles created from the Fall fixture. The fourth row creates one unclaimed
Class of 2026 alumni profile after directory search found no existing target.
All four rows retain Spring 2026 and now show zero unresolved matches. These
actions do not commit applications or approve them. The new dialog has not
been tested live, and the old deployed preview still shows its stale heading.

The corrected combined local suite completed successfully across 306 root and
306 plugin test files, with mock-sensitive files isolated. Repository-wide
formatting passes. PR #494's first quality job stopped at formatting in the
register and operator contract test; both files are corrected locally for the
same PR. No application source changed in these documentation/formatting fixes.
Hosted browser and database replay gates remain required before deployment.

Read-only Production reconciliation during PR #494 verified one chapter,
1,047 profile records, four linked workbooks, and zero application records.
The database still has 460 migrations through `20260906085350`. These are
stored-record counts, not active membership or import-completion claims.
No Production rows or settings changed. Root candidate `3c7f2e47` carries the
operator-documentation correction; CI run `34187688263` is active.

Root integration PR #494 is open at initial candidate `c5362244`. Its local
combined run ended with 1,328 passing root tests and two outdated operator
documentation contracts. The guide now describes the application dialog and
the "Add applications" control, and the control contract follows its extracted
component. All 27 operator/cohort documentation checks pass after correction.
No application source changed for that correction. The complete integrated
suite and PR release gates remain pending.

Private PR #267 passed CI `34187091711` and merged at
`fd9f837282a67e4c65b0cb7eeabd7c6417987e71`. The full private suite passes across
277 files. An old test required the match form outside every disclosure; its
updated six checks cover the first applicant opening by default, collapsed
skipping, row identity, evidence, and unchanged action feedback. The grouped
root suite and hosted UI acceptance are still pending. Docker Desktop reports
that it cannot start, so local browser acceptance is not claimed.

The Development branch's `CSF_DEVELOPMENT_COMMIT_SOURCE_ALLOWLIST` now retains
all twelve previous entries and adds nine live-verified fictional source IDs.
The saved value has 21 entries and remains scoped only to Preview on
`development`. This config change did not create a deployment, enable workers,
queue rows, or change Production. It takes effect with the grouped build.

Local changes replace the application import page with a chapter-wide dialog.
The entry action is "Link Google Sheet". The Sheet determines each row's class
and source semester; no fixed class is submitted. A missing source semester now
requires an officer selection instead of using the review page's semester.
The technical stepper is removed. Column matches, snapshot diagnostics, previous
checks, and the full row table remain available through disclosures. Proposed
AI column matches open for review. The first unresolved application opens by
default, with visible page controls outside the collapsed evidence table.
The existing audited actions and all whole-preview commit blockers remain.
The dialog releases its focus trap while Google Picker is open and returns to
Applications when closed. Live Picker focus and close/reopen checks are pending.

All 45 focused import/dialog/readiness checks pass, as do TypeScript and
zero-warning lint. The earlier integrated run stopped at 1,329 passes and one
outdated runbook gitlink assertion. Its corrected documentation suite passes
13 checks. That does not prove the full grouped suite or this new UI passed
hosted acceptance. The changes remain local on the existing private branch.
No deployment, official import, email send, or Production change occurred.

### Production acceptance recheck, 2026-09-07

Read-only Production queries confirm 460 migrations through `20260906085350`.
Retirement migration `20260907000344` is absent. No posts currently have
scheduled status, but that does not prove scheduling requests are rejected.
Four workbook registry rows exist. `csf_term_applications` contains zero rows,
so application import and live application-review acceptance remain open.
No Production data, migration, approval, deployment, or worker setting changed.
These checks do not prove workbook row completeness or repeat-sync idempotency.

| Class | Linked workbooks | Configured terms | Distinct directory links, all states | Imported applications |
| ----- | ---------------- | ---------------- | ------------------------------------ | --------------------- |
| 2027  | 1                | 8                | 347                                  | 0                     |
| 2028  | 1                | 8                | 281                                  | 0                     |
| 2029  | 1                | 8                | 108                                  | 0                     |
| 2030  | 1                | 8                | 0                                    | 0                     |

Directory links count every membership state and are not active-member counts.
Empty Class of 2030 templates must not be populated merely to change this zero.

### Hosted route latency, Development acceptance verified

Fresh inspection of completed hosted run `34178004263` confirms the route
budgets passed on Development `8a48f7a1`: Classes p95/p99 1,627/3,318 ms,
Applications 2,146/3,550 ms, and mutation p95 1,863 ms. All 9,775 requests
succeeded across 100 distinct sessions. Browser errors and renderer crashes
were zero over 25 review navigations; retained heap fell 11.67 percent.
This supersedes the open latency status below for that exact Development
release. It does not accept the newer Sheet dialog candidate or Production.
The next grouped app release still requires its own hosted measurements.

Earlier P2 evidence: On Development `db4ae419`, run `34085356037` measured officer Classes
read p95 at 3.835 seconds and Applications at 2.566 seconds. Both exceed the
2.5-second route budget despite the pooled gate reporting success. Preserve
this failed measurement and never use its pooled green status as acceptance.
The following implementation notes describe the work before the passing run.

Read-path inspection identifies avoidable work, not yet a measured root cause.
`CsfDashboardCohortPhase.ts` runs the full compose-post loader, reply previews,
and active class-code reads on the class list. `CsfCohortHubSection.tsx` uses
only each post's class and publication state for its cards. The compose loader
also reads authors, class labels, and link previews. Preserve the card counts
with a narrow read model, and load reply and join-code data only for a selected
class. Do not drop counts or replace them with zero as a performance fix.

The initial Applications trace through `dashboard-applications.ts` was not
the rendered route. `CsfDashboardRoutePhase.tsx` loads `review-workspace.ts`
for ordinary Applications; the later paged projection is already disabled.
Do not change the unused reader's retry authorization as a latency fix.
The active review reader loads terms/classes, then campaign/policy/staff,
then subjects, then related review evidence. That dependency chain needs
measurement and scoped optimization without removing displayed evidence.

Local private branch `codex/csf-officer-read-scope` now skips join-code and
reply-preview reads on the class picker. A selected class reads only its own
join code and replies for its published class posts plus chapter-wide member
posts. Existing card post/member counts remain unchanged. Unknown classes and
missing permissions do not enable these reads. Four focused reader tests and
32 class-workspace contract tests pass; targeted lint passes. The full compose
post enrichment still runs and remains an optimization candidate. This local
change has not been pushed or deployed, and no hosted latency gain is claimed.

The class picker also now skips recent activity details and linked-project
enrichment. Individual class workspaces retain that read. Its regression failed
before the change and passes afterward; the class-workspace suite now passes
33 tests. No existing post-count summary RPC was found, so complete post
enrichment has not yet been replaced with a summary projection.

The active application review reader now omits the point-submission query,
including nested club and proof metadata, for application campaigns. The
application panel never renders those service lines. Awarded totals, courses,
application evidence, decisions, and notes remain loaded. Point campaigns still
load submissions and appeals. Two executable mock-backed regressions prove
the read distinction; the application test failed on the prior implementation.
No authorization check was removed. This remains local evidence, not proof
that Applications now meets the hosted latency target.

Grouped local verification: the private-plugin runner passed all 268 discovered
test files with mock-sensitive files isolated. Full zero-warning lint, source
organization checks, TypeScript, and the host-import boundary passed. The first
broad run failed one stale source assertion expecting all-class join-code reads;
the assertion now follows the tested selected-class scope. The 12 root load-gate
regressions also pass. Local private commit `38ce211` preserves this checkpoint.
It has not been published, and the root gitlink has not advanced. No Vercel
deployment or provider mutation occurred during these checks.

### Current Production acceptance, 2026-09-05

Post-release officer review resumed after the Mac unlocked. Full-name search
returned a different profile from the original workbook key. Four prior
committed rows from the same class/file corroborated one active target, including
historical merge lineage. The officer match action saved that target, and a
read-only query confirmed it. Fall 2024 Class of 2027 then committed 254 updates
and retained the one reviewed redundant-row skip.

Class of 2028 Fall 2025 reprepare produced 193 pending rows with no parser error.
Its approval correctly refused with `preview_requires_review`: authoritative
readiness reports one `pendingMissingMatch` despite zero `pendingMissingSourceKey`.
P1 follow-up: Settings ignored this blocker and advertised the preview as ready.
The local private branch `codex/csf-hidden-review-blockers` now counts authoritative
missing matches and refuses that ready state; the regression failed before the
patch and passes after it. Local migration `20260906013133` adds a service-only,
tenant-scoped query for those pending identity blockers. Settings uses that query
and offers the existing audited match/create controls. Valid new source keys do
not become false review blockers. The bounded query does not change snapshots.

P1 privacy/decision follow-up: `interpretCsfImportAnnotationsAction` still builds
activity text and annotations for model interpretation and automatically calls
the annotation-settlement RPC. The "Review markings" control invokes this action
rather than opening evidence. The observed call reported zero settled rows, but
that does not establish zero model transmission. Do not invoke it again. Replace
this path with protected officer evidence and explicit decisions before closure.
No academic approval or account connection was intentionally changed in this run.

Audited worker-control run `34004302603` disabled Production workbook refresh
after this finding. Import processing remains enabled; communications and
scheduled publishing remain disabled. A count-only query for the preceding two
hours found zero recorded annotation AI calls and zero annotation resolutions.
Those counts do not prove that no data left the application. The local patch
removes the automatic preview call and the misleading markings control. The old
action now refuses without reading rows, calling a model, or changing decisions.
An explicit officer evidence/decision path remains unfinished. Do not re-enable
workbook refresh or describe the follow-up as accepted yet.

Local verification: the corrected isolated replay passed 7,097 pgTAP assertions
across 244 files, then stopped at the strict gitlink gate because the private
worktree is on an uncommitted feature branch. Its isolated resources were removed;
the shared local stack was untouched. Full lint and TypeScript passed. The first
root test run stopped on stale release-ledger contracts. Updating the exact
452-migration catalog and current public-release documentation made all 46 focused
release tests pass. The rerun passed every root stage, then found two private
source-contract tests that still required the removed automatic interpreter.
Those tests now require the privacy refusal and pending identity controls.
The separate plugin rerun passed all 291 discovered files, including isolated
mock tests. TypeScript and focused release lint passed again. The new catalog guard checks
the review function's body, result types, defaults, and service-only grants. No
new remote commit, PR, deployment, or Production migration accompanied these fixes.

A fresh read-only Production check still reports 451 migrations through
`20260905212822` and confirms workbook refresh off, import processing on, and
communications/scheduled publishing off for release `00ba3b1e`. The latest
preview per source, restricted to the currently linked file, reports:

| Class | Committed rows | Pending rows | Error rows | Reviewed skips |
| ----- | -------------: | -----------: | ---------: | -------------: |
| 2027  |          1,106 |            0 |          1 |              1 |
| 2028  |            459 |          193 |          0 |              0 |
| 2029  |            150 |            0 |          0 |              0 |

These are import-row counts, not unique profile counts or proof of complete term
coverage. The query returned no Class of 2030 preview; its linked template tabs
need separate registry verification. Class of 2028's pending total includes the
authoritative identity blocker described above despite no ambiguous status rows.

The next local patch adds an explicit officer notes review form using the existing
shadcn controls. It shows up to eight marked cells and 500 characters per note,
requires an outcome and reason, keeps the request ID across uncertain responses,
and refreshes only after a confirmed receipt. Source text renders as text, not HTML
or CSS. Migration `20260906024707` adds the staff-authorized atomic review receipt
and removes service-role access to the legacy settlement helper. Review and import
approval remain separate actions. No model handles this evidence.

Private commit `0956a7d` is in PR #252, based on private `development`. All 293
plugin test files, TypeScript, and full zero-warning lint passed locally. The
revised isolated replay passed 7,107 pgTAP assertions across 244 files, then stopped
at the expected branch/gitlink gate. All generated stack resources were removed.
The exact 453-migration release catalog query also returned its success sentinel
against that isolated database. Forty-seven focused release tests passed. These
checks do not replace browser acceptance or authorize claiming the app is deployed.

A separate count-only registry check confirmed all four class workbooks linked,
each with eight discovered tabs, no recorded registry error, and a prepared version
equal to the registry's last observed provider version. This does not establish
that every tab contains rows or that Drive has not changed since the last check.

Private PR #252 merged as `38e4f695eede00dcfd4f067b128008bc5e6cf9b2` after
`plugin-quality` and GitGuardian passed on `5fb2f86`. The first CI run caught a
1,201-line authorization test; shortening an existing comment restored the
1,200-line limit without removing any assertion. No branch protection changed.
The root gitlink now stages that exact merged private commit, and the strict
submodule check passes.

The pending-row query exposed another contract gap: the reconciliation RPC
accepted ambiguous/conflict rows but refused authoritative pending identity
blockers. Local migration `20260906025852` permits an explicit match only for an
unattempted, unresolved class-history row with a proven identity blocker and an
active target in that class. Queued/running previews remain frozen. Five new
database assertions cover the match, immutable evidence, readiness, replay, and
refusal for an ordinary pending new-profile row. Officer notes review also refuses
a source-key conflict until identity is resolved, so a later match cannot replace
its outcome decision.

The final local isolated gate passed with 454 migrations and 7,112 pgTAP
assertions across 244 files. Its fictional workflow probes, advisors, architecture
and plugin isolation checks, strict gitlink check, TypeScript, zero-warning lint,
plugin login/API isolation smoke, and eleven-route cron auth/shape smoke passed.
The exact 454-migration release catalog query returned its success sentinel on
the same isolated database. All generated resources were removed. This does not
cover a Production build, full CSF browser journeys, hosted acceptance, or providers.
Forty-seven focused release contract tests passed again.

Remaining P1: Class of 2027's error row has a failed attempt, no matched/frozen
target, a valid workbook key, and an authoritative identity conflict. Do not
rewrite its failed attempt or mark it successful. The workbook preparation loop
calls preview without retry lineage. Manual preparation can reuse the failed
immutable preview; the background worker already creates a new preview but omits
the preceding attempt's lineage. The existing generic import UI has Retry corrected rows,
but that path must not run on the old Production app while automatic annotation
interpretation remains deployed. Add source-scoped retry preparation to the
workbook worker before the grouped root release. No Production migration, app
deployment, email dispatch, or new official commit occurred in this continuation.

The local workbook retry patch now finds the latest preview by organization,
source, and Drive file. Known failures and parser errors attach that immediate
preview as retry lineage. Running, in-flight, and unknown outcomes block preparation.
The helper changes only preview input; it does not edit receipts or commit rows.
Six focused tests pass with 25 assertions. All 294 plugin test files, TypeScript,
and zero-warning lint pass. Full plugin verification also passed. Private PR #253
merged as `c822293ff4c700f3e758929cf692613b044a199d` after CI run `34008344966`
and GitGuardian passed on `c66a23a`. No protection changed or Vercel build ran.
The root index now pins that merged commit and passes the strict submodule check.
Forty integrated inventory and release tests pass with 325 assertions. The first
full root test run caught the temporary
private HEAD/root index mismatch, with 1,283 tests passing and that one failure.
The full root suite passed against the corrected index: 300 root and 294 plugin
test files, with every mock-sensitive file isolated. The local Production-mode
build passed with nonfunctional CI backend credentials. Formatting also passed.
Fresh read-only Production checks still report 451 migrations through
`20260905212822`. Each official class from 2027 through 2030 points to its expected
workbook and has eight discovered tabs, its recorded version prepared, and no
registry error. This does not prove current Drive freshness or completed imports.
Root PR #482 passed CI run `34008650409`, including the database/browser job,
and merged to Development as `6f413621b658225757430e3e129a039285e811bc`.
CI reports 7,112 pgTAP assertions across 244 files, three DV browser cases,
and 83 passing CSF browser cases with four skipped. The skipped historical
import journey does not prove the current workbook commit UI.
The marked merge started one Development deployment and hosted acceptance run
`34009457889`. Hosted acceptance and Production changes remain open.

Release continuation on September 6: private promotion PR #254 targets `main`.
Updating its branch for the existing strict checks produced
`b924cc55e376e800d42d92684b5362a0857d5a77`, with an identical tree to the accepted
gitlink `c822293ff4c700f3e758929cf692613b044a199d`. Private CI run `34009813015`
is pending. Repository auto-merge is unavailable; no protection was changed.
Read-only Production inspection still reports 451 migrations through
`20260905212822`. Audited worker transition `34009811550` was dispatched and
approved to pause import processing on public release `00ba3b1e`. The workflow
completed successfully. A fresh database check found zero enabled worker-control
rows. The three pending migrations have not been applied. No new app build,
schema write, official import commit, or email send occurred during this check.

All 43 focused release-controller tests pass. The fresh strict submodule check
now refuses the local private checkout because private Development advanced by
two ancestry-only commits while preparing promotion. Its source tree remains
identical to the accepted gitlink. Keep the accepted root gitlink unchanged;
do not report this branch-tip check as passing or rebuild just to move the pointer.
The local private checkout is now detached at that exact accepted gitlink, as
the CI release checkout is. The strict check passes in that documented mode.
Private CI `34009813015` passed and PR #254 merged as
`db6b5b4c7691cd5b3f837324832bcca00b487ad9`, with the same source tree. Root
Production PR #483 is open. Its current checks and hosted acceptance remain
pending. No Production application or schema change has run.

A new isolated capture is running against fictional stack
`vid0eec8dcbb2` on local port 3002. Its temporary capture script dismisses the
tour through its visible control, then checks the current Applications,
class Members, point-review, workbook Settings, and member profile routes.
That capture reached officer Home, application review/import, and class Members.
It failed on two temporary capture selectors: the class point queue has no
`#applications` wrapper, and My CSF contains nested tab panels. Both selectors
were corrected from the rendered DOM. A replacement capture is running on owned
fictional stack `vid9cbcb0b8ec`. Neither run changes the accepted application
source. The first run's owned stack was removed. Its stale port claim was removed
only after the recorded PID, listener, and owned Docker containers were absent.
The local shutdown `kill EPERM` remains an open harness finding.

The replacement capture on `vid9cbcb0b8ec` passed both browser journeys with no
recorded browser failures. It saved seven 1440x900 screenshots and two MP4s for
officer navigation and the member semester profile. These show navigation and
rendering, not settled officer decisions or automatic workbook preparation.
Database teardown passed, but the app again left a stale port claim. The recorded
PID and port listener were absent before removing that claim. A small diagnostic
with a normally exited detached Node child returned ESRCH, not EPERM, so the
shutdown cause remains unproved and no speculative signaling patch was made.

P2 UI follow-up from the synthetic profile capture: the profile header shows
current Fall 2026 zeros while the selected Spring 2026 history shows two points.
Keep the legitimate empty current semester, but make the header and selected
semester context agree in the requested UI patch. Do not infer missing imported
history from that header alone.

Read-only Resend inventory now shows one enabled Production webhook, one enabled
Development webhook, and four disabled older endpoints. Production has zero CSF
campaigns, deliveries, or provider-event rows. No provider send or configuration
change occurred. The earlier disabled-replacement note is historical; enabled
configuration still does not prove signed-event settlement.
The provider event API reports four successful events on the enabled Production
webhook. The latest delivered-event attempt returned HTTP 200. The CSF provider
event ledger remains empty, so this proves endpoint delivery only, not a CSF
campaign receipt or the requested ten-message acceptance run.

Root release CI `34009973580` passed for PR #483 at `6f413621`. Hosted acceptance
`34009457889` is still live. Its authentication setup deliberately spaces session
creation by 10.5 seconds before the 15-minute load; the run was not restarted.

The profile UI follow-up is isolated in private branch
`codex/csf-member-selected-semester`, worktree `csf-member-selected-semester`.
Local commit `2067cac` is not pushed or deployed. A shared client selection now drives
the header and semester history. The server passes a rendered avatar rather
than a raw profile object across the new client boundary. Current-application
correction controls appear only on the current semester. The redundant header
instruction is removed. The reproduced empty-current-term regression first
failed, then passed with four other focused tests and 31 assertions. Selecting
the empty current semester still shows its truthful zero and empty status. The scoped
TypeScript check passes. Focused ESLint exits zero but emits the standalone
worktree's missing-pages-directory notice, so integrated zero-warning lint and
rendered interaction acceptance remain required. Local `tsconfig.json` and the
dependency symlink are test setup only and must not be committed.

Local recording follow-up on root `354481a1`: the isolated 1440x900 capture
produced account-name confirmation and officer rejection clips. This was not a
fully passing run. The standalone people-lifecycle journey clicked Classes while
the first-login officer tour appeared and never navigated. The opt-in officer
gallery still expects the retired "Review queue" label. Treat both as open P2
browser-harness findings, not evidence that profile approval passed. The full
onboarding/application/point/import video remains incomplete.

The recording runner also reported `kill EPERM` during local shutdown and left
its own port-3002 claim. Its recorded PID had exited, no listener remained, and
the isolated database teardown proved the recording stack absent. The recording
claim was removed after those checks; the older port-3000 claim and shared local
database were left untouched. This local shutdown finding remains open.

Hosted acceptance `33998019303` passed for exact Development
`a3c8604de7fc84434d63b4273bbc29eacbfbe18f` at 23:48 UTC. Its 100 distinct
fictional accounts and sessions issued 9,629 requests with zero errors. Read
p95 was 1,267 ms, read p99 2,089 ms, and mutation p95 1,351 ms. LCP p75 was
1,456 ms, INP p75 32 ms, and CLS p75 0.00210. All 25 review navigations passed
without browser errors or crashes. Retained heap fell 22.8 percent.
Private promotion #250 merged at `93ee53a6d1c867329c8fd554a30987ad8479635d`,
with the same tree as accepted gitlink `06a2e568ef74fc3f44a42b7e637cfef1ea5c0868`.
Root promotion #480 merged at `00ba3b1e54e09127d715bec2cd0bb139747e6a53`,
with the identical accepted Development tree. Audited runs `33999681025` and
`33999696118` paused workbook refresh and import processing. A read-only query
confirmed all four worker switches off at revision 6 and zero active refresh
or import jobs before the root merge. Supabase's Production integration passed
and advanced the ledger from 448 to 451 migrations through `20260905212822`.
No second migration runner was started. App-only run `33999835363` passed exact
schema/catalog, accepted-source, private-gitlink, and Vercel project checks. It
created one staged Production build, `dpl_GowA9smuAXNxsoifTQcn6qKMo6se`, for
`00ba3b1e54e09127d715bec2cd0bb139747e6a53`. The run completed successfully:
staged smoke checks, promotion, exact public alias, and public app checks passed.
The public domain now serves this release. No rollback ran. The rollback target is
`dpl_DYmJHF9tVtDCuE8WYWnr9o6X1THx`.

Runtime-only runs `33999990543` and `34000028038` restored workbook refresh
and import processing on the new public release. Both passed public posture
verification. A read-only query confirms revision 2, these two workers enabled,
and communications plus scheduled publishing disabled. Before activation the
queues contained five completed refresh jobs, nine completed import jobs, and
three blocked import jobs, with none queued or running. These transitions did
not override any officer decision. The Mac remains locked, so protected officer
review, remaining imports, controlled email proof, and synthetic media are not
complete. Release evidence alone does not close those tasks.

Read-only Production reconciliation after the #481 Development merge confirms
four linked workbook registries, eight discovered tabs each, and prepared
provider versions matching each registry's current version. Latest matching-file
class previews contain 1,461 created/updated rows, 445 pending rows, one ambiguous
row, two errors, and one skip. By class: 2027 has 852 committed and 253 pending;
2028 has 459 committed and 192 pending; 2029 has 150 committed; 2030 has no
preview rows. No officer decisions or import writes accompanied this check.

At 23:12 UTC, PR #481 merged into Development at
`a3c8604de7fc84434d63b4273bbc29eacbfbe18f`, identical to the tested
`e5bb1c8d54024c276c899040305419922b896623` tree. CI `33997166619` passed
quality, the build, database replay, and both browser suites. The marked merge
started hosted acceptance `33998019303` for the corrected application tree.
Root Production promotion PR #480 and private promotion PR #250 remain open.
No Production app or schema promotion is proved by this Development merge.

Automation credential rotation after PR #481 opened: created a replacement
Vercel project bypass, updated the Development CI secret and both Production
CI secret names, and replaced only the endpoint query value on the two enabled
Resend webhooks. Readback confirmed both event subscription lists and enabled
states were unchanged. Both app status endpoints returned HTTP 200 with the
replacement before and after revocation of the exposed value. The provider
now reports one active default bypass and no old bypass. No app build or test
email was created. Signing secrets were not changed; CSF message settlement
still requires its separate controlled test. Root CI `33996238491` passed
database replay and both browser suites but failed its documentation contract:
the officer runbook still named the previous private gitlink. Correcting that
reference to `06a2e56` passes all 13 documentation tests with 305 assertions.
These provider changes do not prove the remaining officer imports.

Hosted run `33994088933` passed at 22:25 UTC on `c0d1f595` with 100 distinct
sessions and 9,680 requests. Read p95/p99 were 1,660/2,395 ms; mutation p95
was 1,374 ms. Request errors and 5xx were zero. LCP p75 was 1,624 ms, INP
p75 48 ms, and CLS p75 0.000816. All 25 review navigations passed with zero
browser errors or renderer crashes; retained heap fell 7.7 percent.
Private PR #250 then received a valid review finding: successful batch approval
did not refresh the class queue. The promotion remains unmerged. The narrow
follow-up calls the existing success-only router refresh hook. Its regression
test failed before the fix and passed afterward; eight focused tests, TypeScript,
and focused zero-warning ESLint pass. It needs private CI and integration.
Production workbook refresh was disabled through receipt run `33995872470`.
Restoration run `33995977239` passed and verified the prior enabled state on
the unchanged public app. Private fix `a73c38b` is in PR #251; its security
check and plugin CI `33996024686` passed. PR #251 merged to private Development
at `06a2e568ef74fc3f44a42b7e637cfef1ea5c0868`, with the same tested tree as
`a73c38b`. Root integration now pins that private commit. The earlier hosted
acceptance applies to `c0d1f595`, not this updated application tree. No application deployment,
migration, or officer import was
performed in this turn. Chrome remains unavailable while the Mac is locked.

Release follow-up at 21:48 UTC: CI `33993371446` passed every job on
`a56aa0664129c9971e89602bce9fcb1cf73cf46a`. PR #479 merged into Development at
`c0d1f595cda60625a02cd90ec65c8fd02ef4ac1f`, with an identical tree and the
private gitlink unchanged at `20bcb47c18a1c27cac46852de113e031009f2425`.
The marked merge started one Vercel deployment and hosted acceptance run
`33994088933`. Vercel and the Supabase preview checks passed. Development's
451-version ledger hash matches `a3b709dea637acd1fdd4a8820f8b2830be3fb8c53e8d8ab9d9975a8164f41148`,
and the complete read-only release catalog returned 1 against hosted Development.
The 100-session hosted acceptance step is running. Private promotion PR #250
and root promotion PR #480 are open without auto-merge so their checks can run
before release. Neither promotion has merged. Production's application, schema,
worker flags, and officer imports were not changed by this merge.

PR #479 review follow-up: the workbook reprepare RPC checked the requesting
officer before waiting for workbook and request locks, without holding the
staff-access lock or the officer membership row. The class-history authorizer
does not acquire those locks. Forward migration `20260905212822` now acquires
the organization staff-access lock and holds the actor membership row, then
rechecks authority before returning a receipt or queueing work. It also holds
the workbook owner's membership row during queue authorization. The signature,
server-only grant, immutable receipts, and existing source snapshots stay intact.
Two-session tests prove that a permission-revoked new request and a
membership-revoked replay fail without restarting the worker or adding a
receipt. Full isolated replay passes 451 migrations and 7,090 assertions. The
exact release catalog returns 1 against that database. All 19 controller tests
and 13 documentation contracts pass. The SPEC and controller now name all
three candidate migrations over Production's unchanged 448-migration prefix.
CI `33992278486` passed for the preceding `c8e93e2b` candidate. The lock fix
still needs its own CI and hosted acceptance. No additional deployment or
Production schema change occurred during this review.

The refreshed chapter audit after Spring 2024 commit counts 4,427 profile
activity events and 1,392 attendance records. Every activity event has a title
and an activity-catalog link in the same organization and term. Every attendance
record has a label and a meeting link in the same organization and term. These
relationship checks do not close the pending preview or application imports.

Read-only email audit at 21:25 UTC: all four Resend sending domains are
verified. The current Production webhook has four successful deliveries of
provider events, two `email.sent` and two `email.delivered`. These are endpoint
receipts, not CSF workflow acceptance. The Production CSF ledger has zero
campaigns, deliveries, dispatch attempts, verified provider events, reduced
provider events, and unresolved quarantines. The controlled ten-message CSF
test remains open. No messages were sent or worker flags changed in this audit.
The provider listing returned an automation-bypass value in endpoint URLs.
Treat that credential as exposed, rotate it in the coordinated provider and
environment cutover, and keep endpoint query values out of further output.

Count-only follow-up audit: each official class has eight linked term sources.
Their current previews contain 1,461 committed rows, 445 pending rows, one
identity-review row, two error rows, and one redundant skipped row. The skipped
Fall 2024 row records its retained counterpart; that counterpart contains all
retained facts and remains pending. The skip is mechanical redundancy, not an
unrecorded officer decision.

Further protected evidence for the Fall 2024 identity exception shows that the
raw workbook LastFirst key matches one active class profile, and the historical
merged record points to that same target. The officer UI match has not been
submitted because the Mac locked before selection. No profile merge or account
link was changed. Root CI `33992278486` is still running on `c8e93e2b`.

Initial follow-up: root PR #479 opened at `8d99c29b`. Its quality job failed
because the officer runbook still named the old migration ledger and gitlink.
The local runbook and assertion now distinguish the 450-migration candidate
from Production's verified 448 migrations through `20260905080459`. All 13
documentation contract tests pass. No app deployment ran; Vercel skipped the
feature-branch build.

The officer browser resolved one Spring 2024 Class of 2027 row by creating an
unclaimed source profile after full-name, surname, chapter-name, and source-key
checks found no existing target. The row is now pending with a profile match,
resolution metadata, and two row audit events. No application approval, account
link, or participation commit occurred. The Fall 2024 row remains unresolved:
its same-normalized-name records include an active profile and a merged record
whose destination differs. No match was forced.

That review exposed a separate search defect. Queries strip spaces while the
stored compound surname retains them, so full-name search can hide an existing
profile. Local forward migration `20260905205847_csf_compound_name_profile_search`
normalizes both full-name orders consistently and adds scoped active-profile
prefix indexes. The first fixture incorrectly used an unsupported archived
profile state; the corrected fixture tests exclusion of merged profiles.
Isolated replay passes 450 migrations and 7,081 assertions. The new migration
is not published or applied to Production. The local release allowlist now
includes both exact migration hashes over the verified 448-version prefix.
The catalog checks the search function body, argument and result fields,
permissions, and both scoped prefix indexes. All 19 focused controller tests
pass. A fresh isolated replay passed 7,081 assertions and returned 1 from the
complete release catalog query. Its temporary resources were cleaned up.
The full local runner passed all 300 root and 290 plugin test files.
TypeScript, zero-warning lint, formatting, and strict gitlink validation pass.
The changes still need root CI and hosted acceptance.

The officer approved the now-ready Spring 2024 preview once through the app.
Preview `da61acdf-7d02-4991-9d9b-75f41f47bc1e` completed with 200 committed
rows: 38 created and 162 updated, with zero error rows and no queue error.
Class of 2027 now has 347 active directory profiles and zero duplicate
normalized-name groups. The other class directories remain 280 for 2028,
108 for 2029, and zero for the empty 2030 templates. These counts are not
current-semester membership approvals. Remaining identity decisions and the
Class of 2028 parser-dependent re-preview remain open.

This entry supersedes older release-state statements below. The release is
published, but official data and provider acceptance remain incomplete.

Root PR #478 merged to `main` at
`fda53ee5b06ca74e3f81f98c8d37e06b1f1fa258`, with the same tree as hosted
Development `383ea476ee2f5bf8b13fab0db3b33ab0f849295d`. Private gitlink
`88d5b79aa240a11bb41b5618a5c38cb8ea693099` is reachable from private `main`
and `development`. Root CI `33957447212` passed 7,053 database assertions,
83 CSF browser journeys, all 300 root and 287 plugin test files, TypeScript,
zero-warning lint, and the Production build.

Hosted acceptance `33957164531` passed with 100 distinct sessions and 9,130
requests. Read p95 was 1,401 ms, read p99 2,230 ms, mutation p95 1,809 ms,
LCP p75 2,052 ms, INP p75 16 ms, and CLS p75 0.00210. Request errors and
renderer crashes were zero. All 25 review navigations completed; retained
heap decreased by 11.6 percent. These measurements used fictional accounts.

Production's Supabase check on the main merge applied the two forward
migrations before explicit migration run `33958842854` reached its preflight.
That run refused the already-upgraded ledger before writing. It was not
retried. Independent read-only checks verified the exact 448-version sequence,
accepted function definitions and grants, metadata constraint, and source-key
index. The catalog verifier returned 1. The Class of 2027 readiness call then
evaluated six previews as `service_role` under an eight-second statement limit;
the complete tool round trip took 897 ms. The signed-in Production Settings
page now shows the workbook, semester review controls, and ready approvals.

App-only run `33958927462` built and promoted one Production artifact,
`dpl_DYmJHF9tVtDCuE8WYWnr9o6X1THx`. Staged and public-domain checks passed
for the exact release SHA, backend, login route, and protected CSF route.
The previous app is `dpl_8AShFttCMrv41iEq8AMCLikgRFXu`.
Worker transition `33959098441` enabled only workbook preparation for this
release at revision 1, receipt `45563bae-f590-411f-88be-3b31524849c9`.
Worker transition `33987211232` then enabled import commits at revision 2,
receipt `6701ac15-d997-4324-82d7-e4015ae2d16d`. Communications and scheduled
publishing remain disabled.

The unlocked officer browser approved four Class of 2027 previews, three
Class of 2028 previews, and two Class of 2029 previews. Six queue items
completed. One partially completed with 166 updated rows and one deterministic
identity refusal. Two stopped before creating a commit job. Across these nine
items, 1,111 rows committed: two created and 1,109 updated. No unknown or
in-flight row outcomes remained in the three blocked previews.

The Class of 2027 refusal has no frozen profile target. A read-only source-key
lookup returns no proven target and requires review. Do not remove that check
or retry the unchanged row. One separate Spring 2024 row was resolved through
the audited unique-match action; one Spring 2024 row still needs evidence.

The two Class of 2029 previews froze provider version 1295. The current file is
version 1297 with the same modification timestamp. The Settings relink action
reconnected the same file and queued the refresh worker. The registry now
records version 1297 prepared, eight tabs, and no workbook error. Its fresh
previews contain 62 and 88 rows. The officer approved those exact new previews;
both queue receipts completed and all 150 rows updated. Earlier blocked
receipts remain intact. The eleven approved previews now contain 1,261
committed rows. Class of 2030 stays linked with eight empty templates.

The post-import count-only audit found 4,043 sheet activity events with zero
missing names, missing activity links, or mismatched linked terms. All 1,208
sheet attendance records have meeting links. Active class-directory counts are
308 for 2027, 280 for 2028, 108 for 2029, and zero for the empty 2030 template.
These directory counts do not imply current-semester eligibility or completion.

Repeat-sync reconciliation, remaining profile decisions, application profile
creation through the deployed UI, controlled provider email settlement, and
synthetic screenshots/video remain open.
The completed remote `codex/csf-import-release-followup` branch was deleted
after its commits were proven to be ancestors of Development. Existing
worktrees and user changes remain intact.

#### Follow-up defects found in the officer browser

- P1: per-semester "Sync again" called the legacy direct preview action and
  failed with the worker-only preview guard. The local private-plugin patch
  replaces those buttons with one workbook "Check for updates" control using
  the existing refresh action. Audited batch approval stays separate. Two
  focused regression tests, 21 related tests, all 259 discovered private-plugin
  test files, TypeScript, formatting, and zero-warning affected-file lint pass.
  This patch is not deployed. No build, push, or new pull request ran for it.
- P2: switching classes retains a semester unavailable in the destination
  class. The header and URL show the old semester while the selector shows the
  current semester. The local patch scopes the shared semester selection to
  the selected class before loading member records and building the header.
  It reuses the class-term read and leaves chapter-wide application terms
  unchanged. Empty or unknown classes receive no fallback organization terms.
  Focused scope tests and TypeScript pass. Hosted verification remains open.
- P1: the repeated-slot parser treated any parenthetical text containing
  "point" as a numeric award. A descriptive club-point label therefore
  blocked one Class of 2028 preview. The local fix preserves descriptive
  labels and their repeated-slot counts while retaining reconciliation for
  malformed numeric or written quantities. The regression failed before the
  fix; all 29 parser tests, TypeScript, and focused zero-warning lint pass.
  The immutable Production preview remains unchanged until a new preview is
  prepared under the released parser and approved through the officer action.
- Local follow-up validation: all 259 discovered private-plugin test files
  pass with the parser and term-scope patches. After formatting, the 37 focused
  parser and class-scope tests pass with 115 assertions. TypeScript and
  affected-file lint pass. No push, deployment, or Production data mutation
  occurred during this validation.
- P2: blocked worker receipts use `commit_failed`, concealing whether the
  source changed or another pre-commit check refused it. The UI still labels
  those previews ready. The local patch now carries a closed reason from
  source-evidence refusal through the action to the queue. Database refusals
  report `source_check_failed`; known provider refusals retain their fixed
  category. It does not infer a changed source from database error prose.
  Unrecognized structured codes become `commit_failed`, and provider detail
  never enters queue evidence. Settings now reads one bounded, tenant-scoped
  queue projection alongside the grouped readiness call. Queued, running,
  completed, and refused pre-claim previews cannot appear ready for repeat
  approval. Reviewed row repairs may resume an existing recoverable commit;
  unresolved row outcomes still block it. The UI displays queue progress.
  Hosted verification remains open.

The combined follow-up passes all 259 discovered private-plugin test files,
17 root worker-route tests, TypeScript, and the full zero-warning lint gate.
The source-size guard initially rejected two files over 800 lines; focused
helpers bring both below the limit. A new read-only Production check confirms
eight completed queue receipts and three blocked receipts. The three remaining
Class of 2027 identity rows have no proven source-key target; the refused
Spring 2026 row still requires source-key review. No retry or match was forced.
Chrome's extension debugger was detached, but native Chrome access to the
officer review works. No new build or Production mutation ran in this check.

The grouped private follow-up is committed at
`df79bcb4d195af503b29580f4cbcea0310aa4207` and published in private PR #248
against Development. The full local `plugin:verify` gate passed, including
independent application packages and all 260 discovered private-plugin test
files. TypeScript, source-size checks, full lint, and focused queue tests pass.
The root worker-route adapter remains local until private integration passes.
No release tag or Vercel deployment was created by this step.

Private CI `33989854176` passed on `df79bcb4`; GitGuardian also passed.
PR #248 merged into private Development at
`5ad7cfc0821e0d27387158b2991b86585b387f17`. The merge tree matches the tested
head exactly. The root index now pins that merge commit, and the strict
submodule check passes with a clean detached private checkout. Root publication
and hosted acceptance remain pending; Production still serves the prior app.

Follow-up re-preview audit: `csf_queue_class_workbook_preparation` and the
metadata-refresh enqueue path return `unchanged` when the provider version
already equals `last_prepared_version`. Relinking the same file and version
preserves that value. Therefore a parser-only app release does not prove that
the existing Class of 2028 error preview was rebuilt. The generation-bound
preview opener can preserve the old snapshot and create a different snapshot,
but the worker first needs an authorized re-preparation request. A supported
parser-revision or officer re-preview path remains to be verified or added.
Do not change the Google file merely to manufacture a provider revision, and
do not modify the old preview rows directly.

The local re-preview path now uses forward migration
`20260905202837_csf_officer_workbook_reprepare.sql` and the existing refresh
worker. An explicit officer request binds the class, displayed Drive file,
actor, and request UUID to one audit receipt. It refuses a changed workbook
and active processing, preserves snapshots, and clears only the preparation
marker before queueing the existing generation. Replaying a settled request
returns its receipt without restarting the worker. The existing revision-check
path is unchanged. The UI exposes "Rebuild previews" separately from approval.

The new migration is local only. Full isolated replay passed with 449 migrations,
242 SQL test files, and 7,069 assertions, including request replay, changed intent,
tenant isolation, revoked authority, active-worker refusal, and explicit grants.
The pinned CLI ran from its existing package cache; the shared local database
and machine-wide CLI were unchanged. Disposable replay resources were cleaned
up. All 261 private-plugin test files, TypeScript, and full lint pass. Hosted
re-preview, concurrency acceptance, migration rollout, and Production commit
remain open. Old app versions do not call the new RPC. Rollback disables the
new UI path without removing its additive function or audit receipts.

Private commit `93de580062e4d7c327b90a1da1807bf449afec50` is published in
Development PR #249, now merged at `20bcb47c18a1c27cac46852de113e031009f2425`
after private CI `33991005657` passed. Full `plugin:verify` passed, including all 261 plugin test
files. Replayed rebuild receipts now say the request was already recorded,
rather than implying that a finished job was just queued again. The focused
service suite passes all eight tests. The root index pins the exact private
merge, whose tree matches the tested head. Strict gitlink validation passes.
Root publication and hosted acceptance remain pending. No Production build or data change occurred
during this follow-up.

The follow-up release controller initially refused migration 449 because its
allowlist still named the preceding two migrations. The local controller now
allows only the new migration's exact SHA-256 and the complete 448-version
prefix. Its catalog query checks the new function body, signature, permissions,
and unique receipt index. All 18 focused controller tests pass. A fresh isolated
replay passed all 7,069 database assertions and executed the complete release
catalog query successfully, returning 1. Its temporary resources were cleaned
up. This is local evidence, not hosted or Production acceptance.

The earlier pre-commit count-only audit confirmed four workbook registries, 32
discovered tabs, four current prepared versions, and zero workbook errors.
The new deployment recorded five HTTP 200 workbook-worker responses after
activation. Its observed post-promotion log window contained no recorded 5xx.
These short-window observations are not a claim of long-term availability.

| Class | Linked term sources | Pending preview rows | Ambiguous | Error | Skipped | Pending without a profile match |
| ----- | ------------------- | -------------------- | --------- | ----- | ------- | ------------------------------- |
| 2027  | 8                   | 1,104                | 3         | 0     | 1       | 0                               |
| 2028  | 8                   | 651                  | 0         | 1     | 0       | 1                               |
| 2029  | 8                   | 150                  | 0         | 0     | 0       | 0                               |
| 2030  | 8                   | 0                    | 0         | 0     | 0       | 0                               |

All-class readiness completed under the service-role eight-second statement
limit. At that earlier audit, previews contained no committed rows and no in-flight or unknown
outcomes. Pending does not mean ready: preview approval must still revalidate
sources, permissions, conflicts, and the unmatched Class of 2028 row. Class of
2030 remains an empty template workbook.

### Production configuration and workbook worker, 2026-09-05

The accepted application `dfe7fa586a8c55789cab194d4c7f2fab9cd254c2`
now serves `lets-assist.com` from deployment
`dpl_8AShFttCMrv41iEq8AMCLikgRFXu`. Run `33952787777` built this artifact
once after its accepted-tree, CI, schema, and project checks passed.
Its stage checker rejected Vercel-generated aliases because `aliasAssigned`
was true. The exact custom-domain query proved the public domain was unchanged.
The operator then verified the staged status, Production backend, disabled
workers, login HTTP 200, and protected CSF redirect before promoting that
existing artifact. Public checks passed after promotion. No second build,
migration, student import, or application approval occurred in this release.
The previous app rollback target is `dpl_858adwbvCDtPEUq2gdhopRMTH1GJ`.
Count-only receipts are in `.artifacts/app-only-stage-33952787777/`.

Worker transition `33953257822` passed with receipt
`e4a0f424-ba77-4496-8698-a3381af1516e`, control revision 3.
Only workbook preparation is enabled. Import commits, communications, and
scheduled publishing remain disabled. The actual hosted workbook cron returned
HTTP 200. All four jobs completed on their first attempt and recorded all
32 canonical tabs. Class of 2027 prepared six populated tabs and two templates;
2028 prepared four populated tabs and four templates; 2029 prepared two populated
tabs and six templates; 2030 recorded eight empty templates. No workbook job
failed. Individual row conflicts remain for officer review. These are
preparation results, not import completion.

Open P1: the application-row new-profile action rolls back because the
eight-argument reconciliation function modifies immutable `normalized_data`.
The protected UI reproduced the failure on one new application target.
Preserve the source guard. Add a forward migration and behavioral database
coverage for reviewed metadata, atomic creation, and retry receipts before
retrying this action. Meeting-attendance consumers currently read matching
metadata from the normalized snapshot and must retain provenance when the
metadata storage changes.

The staging regression is fixed locally, not published. Generated Vercel
aliases are allowed; custom domains and malformed aliases are refused.
The separate authoritative public-domain checks remain required. Twenty-one
focused tests, zero-warning focused lint, strict gitlink, and diff checks pass.
Group this controller change with the remaining follow-up instead of creating
another application build for it.

PR #475 merged main into development at
`94d97335e719b01c2f90190bcb12254bf06dc154` after full CI run
`33952772826` passed. No application deployment was requested for that sync.

Open P1: Production Class Settings shows the source picker but no linked
workbook or ready-preview controls, including when Spring 2024 is selected for
Class of 2027. The eight saved class sources and six preview-readiness results
exist in the database. The data phase catches any class-settings loader error
and replaces the entire workspace with null. Diagnose the underlying query
failure and display an honest recoverable error instead of an unlinked state.
No ready previews were approved while this UI path was unavailable.

The missing Settings workspace is now reproduced as SQLSTATE 57014 under the
same eight-second timeout configured for Production's PostgREST role. The
readiness batch repeatedly calls the source-key conflict resolver, which scans
committed historical rows and evaluates their JSON identity expression.
Disabling JIT did not remove the timeout. A forward migration,
`20260905075711_csf_import_source_key_lookup_index`, adds an organization/class
expression index only for created or updated import rows. It changes no
identity rules, grants, or source records. The isolated replay passed 447
migrations, 240 test files, and 7,036 assertions with this index, then removed
its disposable database. Production does not yet have this migration. Verify
the same readiness query and visible Settings controls after release before
closing the finding. The recoverable UI error and profile-creation fix remain
open follow-up work.

Application profile creation is fixed locally by forward migration
`20260905080459_csf_import_review_metadata_snapshot`. Reconciliation stores
officer metadata in `resolution_metadata`, leaves source snapshots unchanged,
and preserves the metadata in meeting attendance and resolution audit records.
Internal function permissions remain restricted to their authorized wrappers.
The new behavioral test reproduced the rollback before the fix. Afterward,
the complete isolated replay passed 448 migrations, 241 test files, and 7,053
assertions. Coverage includes new unclaimed profile creation, unchanged source
evidence, no canonical email or term approval, request replay, changed-request
refusal, member denial, and meeting attendance provenance. The existing source
trigger returns SQLSTATE P0001; this migration preserves that behavior rather
than changing its error contract incidentally. Neither new migration has been
applied to hosted Development or Production yet.

Private PR #246 passed CI run `33954813548` and merged to private Development
at `1aa3fff02b224d9edd61ca481bf78bd08a76e4ff`. Settings now returns a separate
read-failure flag and shows a retry link that preserves the selected class and
semester. It does not show the sheet-link picker after a failed read. Local
TypeScript, full zero-warning lint, and all 287 plugin test files passed.
This UI change has not been deployed.

The app-only schema checker now recognizes the exact reviewed 448-migration
ledger and checks the new function definitions and grants, metadata constraint,
and valid scoped index. All 26 controller tests passed. The complete generated
catalog query returned 1 against the fresh isolated 448-migration database;
that replay also passed all 7,053 assertions. Unknown or partial ledger
upgrades still fail closed. These checks do not claim hosted acceptance.

PR #477's first quality run stopped on formatting in the stage controller.
The local full root suite then caught the stale officer-runbook ledger and the
previous migration pair in the forward-migration controller. Both now match
the reviewed 448-migration candidate. The controller requires disabled workers
before writing, locks their control table during the transaction, and retains
existing worker receipts. It approves only the exact hashes of the two new
migration files. All 36 focused controller tests and 13 documentation contracts
pass. The local production build passed with non-production test variables.
The feature-branch Vercel deployment was canceled by its ignored-build rule.
No application build or Production data change resulted from that Git push.

Private promotion review #247 found that the Settings fallback also hid class
rename and archive/restore controls. Private Development `88d5b79` limits the
fallback to spreadsheet controls and retains the separate class-management
permission checks. Focused tests, lint, and TypeScript pass. The correction
advanced Development by a permitted fast-forward and stays in the existing
promotion PR. It did not change branch protection or deploy an application.

### Release build and worker activation, 2026-09-05

The app-only run `33933383403` stopped at Vercel's ignored build step. Deployment
`dpl_C4c8YQXnCS9KDKhvxiAbwyoy2jLD` is canceled and never reached application
build or promotion. The local candidate replaces the ineffective request
property with an exact-SHA, Production-only build-policy input. Automatic
feature-branch and `main` builds remain disabled. It needs fresh hosted
acceptance because the accepted older source lacks this rule.

The same candidate replaces the per-worker Vercel rebuild workflow with an
operator-only database transition. Forward migration `20260905003409` scopes
switches to a release SHA and preserves immutable request receipts. The runtime
may read switches but cannot enable itself. All four worker routes and status
use one shared reader. Unknown responses recover from receipts rather than
repeating writes. The workflow supports independent disable without changing
the app deployment or deleting queued work.

Focused local checks pass, including 18 pgTAP assertions for controls and seven
behavioral transition tests. The 446-migration replay passed 7,032 pgTAP
assertions, workflow and architecture checks, then stopped at a checkout-state
guard: the private checkout was on a stale local `development` branch. Detaching
at the unchanged, published gitlink `aa59be85` fixed the strict check. A fresh
full gate then passed, including browser isolation, cron probes, and teardown.
The full suite also passed 296 root and 287 plugin test files. Production
schema, records, workers, and public app remain unchanged. Exact CI, hosted
acceptance, deployment, official reconciliation, and provider settlement are
still open.

CI run `33934734415` passed quality and database/browser replay on `41cfee31`.
CodeQL flagged a URL substring assertion in the worker-transition
test. The follow-up uses an exact parsed hostname, with all seven focused
tests and formatting passing. Its remote scan is pending.

Vercel now stores `CSF_WORKER_CONTROL_MODE=database` only for Preview branch
`development` in project `lets-assist`. CLI readback confirmed both the Preview
target and branch. The browser draft was discarded because it selected the
local Development environment instead. No deployment or worker activation
occurred for this setting. Production configuration remains unchanged.

The promotion merge now includes `main` through `2c19007f`. Resolving its four
conflicts kept the candidate tree unchanged at `fad7d255`; release tests,
TypeScript, and formatting passed. The worker transition also now reuses the
existing automation bypass secret for fixed-origin public status checks, as the
app-only smoke already does. Tests require redirect refusal, no credential in
Supabase requests, URLs, or receipts, and no mutation after a challenged status
response. This does not disable Vercel protection or create another app build.

### Promotion safety fixes and cleanup, 2026-09-04

Private PR #245 merged at `aa59be85`. Its GitHub quality run `33931479076`
passed. This fixes both P1 findings on private promotion PR #244: reply paging
now requires active organization membership and runtime access before a
service-role read, and changing member-search result identities resets the
point recipient selector. Local verification passed 64 focused tests, all 258
isolated private-plugin test files, TypeScript, and zero-warning focused lint.
Root integration, hosted acceptance of this exact correction, and Production
promotion remain required.

Cleanup removed 57 obsolete remote branches and 119 local branches after
ancestry or patch-equivalence checks. Nineteen retired checkout folders are in
Trash, with ignored files preserved. Recovery refs remain under
`refs/archive/cleanup-20260904`. The original private field-mock edit remains
uncommitted and recoverable from stash `3f69a2898f707b4fad0ec519ea3ab932224a5aae`.
Active release worktrees remain until both repositories finish promotion.

Hosted acceptance run `33927863265` passed for root `e130f0f0`, private
`70e689e`, with 100 distinct sessions and 9,566 requests. Read p95 was 1,715 ms,
mutation p95 was 1,839 ms, and request errors were zero. LCP p75 was 2,336 ms,
INP p75 was 48 ms, and CLS was 0.0021. The 25-navigation review loop had no
renderer crash and retained heap decreased by 11.7 percent. This evidence
predates the two safety fixes and does not certify the updated application.

Live Production still serves root `b5029aaf` on deployment
`dpl_HtRch4K8gor7owGrZva4fiEunkLg`. Resend sending domains are verified, but
both Production webhook endpoints remain disabled. No Production app, schema,
official import, or mail dispatch changed during this verification.

### App-only protected-secret build repair, 2026-09-04

Production release run `33928920544` verified the new team-scoped Vercel
credential, exact accepted source, read-only schema compatibility, private
gitlink, and previous public alias. Vercel pulled Production secret variables
as `[SENSITIVE]`. The environment validator rejected that placeholder as an
invalid Supabase URL before Next.js compilation or deployment began. This is
the behavior described in Vercel CLI issue `vercel/vercel#17514`.

The controller repair creates one staged Vercel-side build from the exact
accepted GitHub commit. Existing secrets stay inside Vercel. The request
disables automatic domain assignment and all four CSF workers in both build
and runtime environments. It overrides the ignored-build command for that
explicit deployment only, without changing the project's automatic-build
settings. The workflow records the deployment ID before waiting and never
retries an uncertain creation request. The existing staged smoke, public
promotion, and alias recovery checks remain required. Eighteen focused tests
pass. CI, the staged build, and public release are still pending.

This change does not apply migration `20260904010000`, commit imports, approve
applications, activate workers, or change provider credentials. The name-claim
follow-up is deployed to Development at `e130f0f0`; its hosted acceptance run
`33927863265` is still running. Production remains on `b5029aaf`.

### Current app-only release continuation

The following facts supersede older candidate and release statements below.
Root `main` contains `336b5a8c`, whose tree equals hosted-accepted Development
`06c463f0`; both use private gitlink `2affd09`. Hosted run `33723424303` passed
100-session acceptance with zero request errors and mutation p95 of 1.83 seconds.
Production Supabase was checked through read-only queries at 444 migrations
through `20260903050000`; the existing target-schema catalog check returned 1.
The last verified public app still serves `b5029aaf`. No new app deployment or
official import commit is claimed here.

Production DVHS CSF selects application runtime `1.2.20` at deployment
`dpl_8tuoA9HEbxBYqYtCzX44kvWQqZaq`, separate from the host. The app-only host
release does not update that selection. Source routing limits this child to
`access-proof`; member and officer screens remain host-owned and update with
the host release. Child runtime selection is not evidence for those screens.

The app-only controller merged through PRs #461 and #462. Controller CI
`33833348458` passed, including database replay and CSF browser workflows.
The first authorized run, `33834402466`, stopped before schema checks or a
Vercel build: GitHub's combined commit-status projection omits the creator
field required by the acceptance guard. The correction reads individual
statuses, which retain that field, without relaxing the author check. A live
read-only source check now confirms the accepted SHAs and identical tree.
Twelve focused tests cover the correction and private-error suppression.
The correction merged through PRs #463 and #464 into controller `497d9569`.
Run `33836580294` passed accepted-source and authenticated read-only Production
schema verification, then stopped at Vercel project binding with HTTP 404,
before installing dependencies or building. The release token was scoped to
the child project `lets-assist-csf`, not the host project `lets-assist`.
The local Vercel CLI credential is expired and is not a deployment fallback.

The user replaced the Production release token on September 4. Run
`33838599165` then passed accepted-source, read-only schema, project binding,
and private-gitlink checks. It stopped before building because both embedded
alias-selection expressions contained a literal backslash inside quoted jq
code. The controller-only correction removes those characters from capture
and recovery. A regression test executes both actual workflow filters against
synthetic aliases and verifies refusal of missing, duplicate, cross-project,
wrong-domain, and null-deployment results. All 13 focused release tests pass.
Controller PR #466 passed full CI `33838769723` and merged to Development.
Production promotion PR #467 passed refreshed CI `33839970326` and merged at
`de7de45e`. App-only run `33840907190` passed source, schema, project, gitlink,
and alias verification, then failed during `vercel pull`, before compilation
or staging. The replacement token has host-project scope. Vercel CLI 59.3.0
also requests the owning team and returns `PROJECT_UNAUTHORIZED` when that
lookup is forbidden. Upstream issue `vercel/vercel#17506` remains open for
this exact project-scoped-token failure. No deployment or database write ran.
The operator must replace the GitHub Production environment `VERCEL_TOKEN`
with a short-lived token scoped to Let's Assist Team to use this CLI path.
That scope covers the team's projects, not only the host project. Credential
creation and submission remain a user handoff. No permissions were expanded
by the agent, and the workflow was not retried after this diagnosis.

### Account-name claim follow-up, September 4

Private PR #243 passed CI and merged to private Development at `70e689e`.
The root follow-up uses that exact gitlink and forward migration
`20260904010000`. Version 4 confirmation uses the exact full account name,
including middle names and multiword surnames. A separate versioned RPC leaves
old open pages review-only. Officers see the recorded connection basis; prior
unknown basis is not inferred from names or notes.

Local evidence: 258 private test files, TypeScript, zero-warning lint, and strict
private gitlink checks pass. A fresh isolated replay applied all 445 migrations
and passed 7,014 assertions in 238 files, including new cross-session identity
lock, legacy-endpoint refusal, connection provenance, replay, and access checks.
Seven compiled-browser join scenarios pass, including verified-email connection,
account-name confirmation and reload, ambiguous review, and officer rejection.
These are local results, not hosted Development or Production acceptance.

Production recheck at `2026-09-04T04:45Z`: the public alias still resolves to
`dpl_HtRch4K8gor7owGrZva4fiEunkLg` at `b5029aaf`, and the database still has
444 migrations through `20260903050000`. Root PR #465 at `04317c24` is now
ready for review. Required CI run `33837849001` passed quality, database replay,
and browser checks; the earlier draft run skipped quality and database checks.
The final local run passed all 293
root test files, TypeScript, zero-warning lint, and changed-file formatting.
No new Vercel build was started for this recheck.

Count-only Production checks found 4,038 sheet activity records with no blank
labels, missing or cross-scope catalog links, or repeated per-profile/term
source references. All 1,208 attendance records have labels and same-scope
meeting links. There are two verified account links, no current-semester
memberships, and no term applications. Import history contains 28 completed
commits, 22 completed previews, one failed preview, and 30 previews needing
resolution. No workbook refresh jobs, new commit-queue entries, CSF email
attempts, or CSF provider events exist. These structural checks do not prove
source completeness, correct point values, or repeat-sync acceptance.

Both Production Resend endpoints remain disabled. No database mutation,
import decision, email dispatch, or paid service change was made during this
audit. The later token replacement and CLI limitation are recorded above.

The subsequent Class of 2030 browser check found the same Drive file identity
already linked in Development with eight discovered tabs. The Production
picker and link action both read its metadata. The live action then refused
the empty template with: "No populated canonical semester tab with First and
Last name columns was found for this class." Readback confirms zero workbook
registries, sheet sources, and profiles for that class. The deployed private
gitlink `613ed1a` contains that refusal; the accepted release contains the
empty-template linking repair. No fake row or direct database registration
was used. PR #465's original candidate passed the full required CI run.
The follow-up now includes the reviewed controller merge from Development;
the integrated candidate must pass its checks before merging.

The read-only Production baseline remains 306, 280, 108, and zero directory
profiles for classes 2027, 2028, 2029, and 2030 respectively. Current-semester
active membership is zero in each class. Three workbook registries have no
discovered-tab snapshot; 2030 has no registry. Official Production reconciliation
and audited batch commits remain open. Do not replace these counts with the
separate Development preview counts.

Resend's Production webhook endpoints are disabled. The sending domains are
verified, but neither fact proves dispatch or signed settlement. Keep workers
disabled until controlled test messages settle. The team billing page confirms
Speed Insights Plus is unchecked. No paid feature was enabled.

The app-only controller uses separate accepted-source
and controller identities. It uses the Supabase management read-only endpoint,
stages one Production build with CSF workers disabled, verifies authentication
and health, and restores the previous app alias on failed promotion. All 293
root test files, TypeScript, zero-warning lint, and strict gitlink checks pass.
Deployment and public browser acceptance remain open.
The rejected external-drive backup setup is not a prerequisite for this
app-only path; database-cutover recovery has not been bypassed or reported as
complete. Name-only claiming remains a separate requested product change.

No known P0 remains. `AUD-090` is closed. `AUD-091` through `AUD-109` have
repository fixes in the current integration worktree, but remain active release
findings until the exact root commit passes CI and hosted Development gates.
Production has not changed.

The current root index and checked-out submodule point at private `development`
`7597fdc0bd55dd5ed985d482adcbc5af9379cc9b`. Private PR #240 is merged, and
that revision is published and reachable from private `origin/development`.
The exact root release SHA will be recorded only after the gitlink and all root
changes are committed together.

The complete working-tree isolated gate applied 440 migrations and passed
6,971 assertions across 237 database files. It also passed the CSF database
workflows, local advisors, architecture and access audits, strict private
containment, TypeScript, zero-warning lint, browser isolation, and the
581-assertion cron safety smoke. Exact-commit repository tests, CI, and hosted
Development acceptance remain open.

| Current rows    | Repository state                                        | Remaining release evidence                                                                                  |
| --------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `AUD-090`       | Closed                                                  | Provider setting verified; no deployment required                                                           |
| `AUD-091`–`109` | Source-fixed in the current private and root candidates | Exact-tree gates, one hosted Development deployment, browser and load acceptance, then Production promotion |

The former active rows `CLEAN-004`, `CLEAN-005`, `CLEAN-012`, and
`AUD-031-MEETING` carry only hosted or external acceptance. The Hosted
Development apply and acceptance queue below tracks those gates.

## Exact-tree completed repository rows

These earlier findings remain repository-complete on the current integration
worktree, which points at private `development` `7597fdc`. They are not active
implementation work. The concise closure index retains every exact ID and the
historical subject it closed.

| ID                            | Historical finding closed                                                                                                                                                                                                                                                                                                                                                                                                                                             | Exact-tree closure evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CLEAN-009                     | Reusable invitation links could mutate or misstate delivery telemetry.                                                                                                                                                                                                                                                                                                                                                                                                | Exact replay and link lifecycle contracts pass; link creation/renewal remains separate from delivery truth.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| CLEAN-011                     | Pending/result dialog state, repeat suppression, focus, and live-region defects.                                                                                                                                                                                                                                                                                                                                                                                      | Integrated private UI and automated accessibility-state contracts pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| CLEAN-014                     | Member post payloads exposed officer-only delivery state.                                                                                                                                                                                                                                                                                                                                                                                                             | Integrated permission-shaped projections omit officer delivery state from member payloads.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| CLEAN-019                     | Representative member/application search scale was unmeasured.                                                                                                                                                                                                                                                                                                                                                                                                        | Repository-complete on the then-current exact local 290 schema using rollback-only synthetic `EXPLAIN (ANALYZE, BUFFERS)`: 1,000 profiles / 600 applications; directory 0.294ms/38 shared hits/157kB; queue 0.155ms/40 hits/104kB; 200 relation batch 0.265ms/17 shared + 4 local hits/83kB. There was no disk spill, the transaction was rolled back, and neither a budget raise nor correction UI was needed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| AUD-004                       | Plugin-install uniqueness/control-plane drift.                                                                                                                                                                                                                                                                                                                                                                                                                        | Existing constraint/action regression evidence passes on the integrated tree.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| AUD-006                       | Notification code crossed the server/client boundary.                                                                                                                                                                                                                                                                                                                                                                                                                 | Admin-client and module-boundary tests pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| AUD-014                       | Lifecycle/audit migrations were integrated in the wrong order.                                                                                                                                                                                                                                                                                                                                                                                                        | The exact 292-migration ledger replays in canonical order.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| AUD-016                       | DV private-plugin closure.                                                                                                                                                                                                                                                                                                                                                                                                                                            | Published private integration and retained CI/build/browser evidence are recorded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| AUD-017                       | Paper-signup closure.                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Retained clean build/CI evidence plus current exact gates pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| AUD-018                       | DV guardian closure.                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Retained CI/browser evidence plus current exact gates pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| AUD-037                       | Private activity/partner action wrappers claimed a failed outcome after authorization loss.                                                                                                                                                                                                                                                                                                                                                                           | Fixed in published private lineage `c33b9c2`, retained through protected private `main` `a55c10d` and the candidate root gitlink, with safe unknown-outcome wording and focused tests. Historical wording identified this as `CSF plugin (private repo)`, said `Repository-side scope is closed`, pointed to `supabase/tests/contracts/csf_activity_partner_authorization_lock_source.test.ts`, and concluded `Not fixable from this repository` while remediation belonged to the private plugin repository; those statements are retained only to explain the former boundary and are superseded by publication.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| AUD-040                       | Meeting option payloads were unbounded and included personal email.                                                                                                                                                                                                                                                                                                                                                                                                   | Integrated bounded server search returns identifiers/disambiguating labels without personal email; focused tests pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| REL-001-STAFF-YEAR            | Historical staff positions could retain CSF authority after their school year.                                                                                                                                                                                                                                                                                                                                                                                        | Current-year checks now apply in the TypeScript loader and database authorization predicates, the loader fails closed without a configured current term, and the focused unit plus `csf_current_school_year_staff_authority.test.sql` pgTAP contracts pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| REL-002-LOCAL-CATALOG-VERSION | The local seed downgraded the DVHS CSF catalog after the `1.0.0` release migration.                                                                                                                                                                                                                                                                                                                                                                                   | The seed now publishes `1.0.0`; the complete 308-migration replay including local seed passed, followed by the focused `csf_plugin_1_0_release.test.sql` pgTAP contract.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| REL-003-COMMS-DIAGNOSTICS     | Operator documentation and its label contract still instructed officers to manage raw communications provider identifiers after the officer UI intentionally removed them.                                                                                                                                                                                                                                                                                            | The operator guide, officer runbook, and chapter-onboarding guide now describe only **Ready**, **Needs provider setup**, and **Check communications setup**; the label contract pins those officer-safe states and passes 21 tests with 157 expectations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| REL-004-CURRENT-YEAR-FIXTURES | Five legacy pgTAP fixtures did not configure a current term matching their synthetic staff positions, so the new fail-closed school-year authority rule correctly denied their nominal happy paths.                                                                                                                                                                                                                                                                   | The fixtures now create or advance the matching synthetic current term without weakening runtime authorization. The five files pass together: 721 assertions covering points, post replies, import recovery, meeting permissions, and reply concurrency.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| REL-005-E2E-TYPECHECK-MEMORY  | The database/browser CI job compiled and type-checked the application in parallel while the isolated Supabase stack was resident, exhausting its bounded memory and ending Next's type-check worker without a diagnostic even though the required standalone typecheck and production build passed on the same SHA. The first control was wired to the CSF browser build and an unrelated DV database step, leaving the DV browser build exposed to the same failure. | Both DV and CSF isolated production-browser builds now skip only their redundant Next-integrated typecheck when an explicit CI control reaches the isolated production-browser dist directory. Ordinary local, Vercel, Development, and Production builds remain unchanged; the required quality job still runs standalone typecheck plus a full production build. The focused CI and isolated-runner contracts pass 67 tests with 422 expectations, formatting passes, and the prior standalone typecheck and full build pass on the same source SHA.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| REL-006-PUBLIC-CLASS-PRIVACY  | Public organization class cards opened published class Stream and Activities content, while the sign-in and existing-profile claim choices were separated from the permanent class-code join path.                                                                                                                                                                                                                                                                    | Anonymous class cards now lead only to the permanent class-code join flow; public class routes expose safe class identity plus join/sign-in/claim guidance and no Stream, Activities, roster, membership, or student state. Exact verified-email claims remain automatic, ambiguous matches require officer review, and name-only linking remains forbidden. Private PR #61 passed `plugin-quality` and GitGuardian and merged to private `development` as `86f9727460db24f50a444c7b69c4cfac242164f0`; root lint, typecheck, production build, strict gitlink validation, seed contracts (29 tests / 318 assertions), migration validation/replay, and the 314-migration/155-file/5,833-assertion isolated database gate pass on the predecessor candidate. The complete production-mode CSF browser run recorded 74 passed and 4 intentional skips; its five failures were rerun from a restored fixture, with four passing unchanged and the remaining lifecycle navigation race passing after canonical URL waits were added. Hosted Development merge SHA `59f916ad30b423137ae2134ca4b516a8938714f1` served the anonymous class directory and selected-class permanent-code form with no class Stream, feed, activities, roster, membership, or student state; authenticated Chrome rendered the exact-field profile-claim dialog and member-only class feed. Permanent-code submission, verified-email claim, ambiguous officer review, and the single policy-consolidation follow-up remain separate hosted gates. |
| REL-007-PLUGIN-VERSION-RLS    | Hosted Development Performance Advisor reported two permissive authenticated `SELECT` policies on `public.plugin_versions`, causing redundant policy evaluation.                                                                                                                                                                                                                                                                                                      | `20260817133000_consolidate_plugin_version_read_policies` preserves anonymous published-release visibility and authenticated published-or-trusted visibility with exactly one policy per role. The fresh isolated database reached exactly 315 migrations through `20260817133000`; the focused rollback-only pgTAP file passed 16 assertions, and release contracts, lint, typecheck, strict gitlink validation, and production build pass. Full isolated startup was blocked by machine-wide Docker contention from older stacks, so the clean GitHub replay and hosted advisor recheck remain release evidence rather than being overstated as local proof.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### Integrated project/auth findings

The scoped aliases below prevent the historical duplicate IDs `AUD-030`,
`AUD-031`, and `AUD-033` from being confused. Their detailed finding text is
retained in the historical section.

## Hosted Development apply/acceptance queue

Repository implementation and exact local gates are complete for these rows.
They are not active repository write work; only the named hosted Development
apply, advisor, or acceptance evidence is missing. Production is not implied.

| ID                           | Historical scope                                                                                                                                                                           | Remaining hosted Development evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLEAN-018                    | Duplicate reusable class-link preflight.                                                                                                                                                   | Apply and accept named-conflict resolution through the product.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| REL-006-PUBLIC-CLASS-PRIVACY | Public class privacy and permanent-code join/sign-in/claim flow.                                                                                                                           | On the exact hosted Development SHA, verify anonymous organization and class routes expose no class Stream, Activities, roster, membership, or student state; verify permanent-code join, verified-email claim, ambiguous-match officer review, and authenticated member workspace access with role-separated accounts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| CLEAN-021                    | Project-cancellation snapshot/recovery ledger.                                                                                                                                             | Hosted worker/recovery acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| CLEAN-006                    | Profile-merge identity refusal/success journeys.                                                                                                                                           | Local browser refusal/success and same-name protection proof passed; hosted Development apply and acceptance remain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| CLEAN-007                    | Application queue → detail → modal preflight.                                                                                                                                              | Local browser queue → detail → modal proof passed; hosted Development acceptance remains.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| CLEAN-008                    | Composer reachability and partial/unknown post outcomes.                                                                                                                                   | Local browser compose, idempotency, member-denial, and queued-email-truth proof passed; hosted Development acceptance remains.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| CLEAN-010                    | Historical import preview, reconciliation, retry, and write blockers.                                                                                                                      | Local browser preview → reconcile → synthetic-commit proof passed; hosted Development apply and acceptance remain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| CLEAN-013                    | Fail-closed account-connection corroboration.                                                                                                                                              | Local browser identity refusal/success and same-name protection proof passed; hosted Development acceptance remains.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| CLEAN-015                    | Schedule → Feed publication and scheduler invocation.                                                                                                                                      | Local member Feed surface proof passed; hosted/default-branch invocation acceptance remains.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| CLEAN-017                    | Staff access and class-link refusal journeys.                                                                                                                                              | Local browser class-link, profile claim, not-me, and Staff access proof passed; hosted Development apply and acceptance remain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| CLEAN-004                    | Exact role/breakpoint accessibility acceptance for the CSF lifecycle.                                                                                                                      | Local automated accessibility proof passed on the exact tree: a full default Axe scan failing on critical findings for anonymous, member, and admin roles at phone, tablet, and desktop, plus keyboard order, dialog focus restore, ARIA/live-region, navigation semantics, and reduced-motion checks. The critical-only Axe threshold is intentional and lower-impact violations remain attached to the run, not hidden. Manual screen-reader and hosted Development role/browser acceptance remain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| CLEAN-005                    | Role-separated synthetic mutation acceptance at desktop, tablet, and phone for the complete CSF lifecycle.                                                                                 | Local role/viewport browser matrix proof passed within the full CSF Playwright run (79 passed, 3 opt-in screenshot-gallery skipped, 0 failed), including synthetic staff submit/withdraw cleanup and member denial; hosted Development role/browser acceptance remains.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| CLEAN-012                    | Role-separated communications settings, send/cancel recovery, and visible truth.                                                                                                           | Local browser proof passed for the admin Settings entry and the co-president tablet queue/cancel durable ledger truth with no provider dispatch or events; provider behavior and hosted Development acceptance remain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| AUD-031-MEETING              | Meeting roster minimization and exact attendance/import authorization journeys.                                                                                                            | Disambiguated from `AUD-031-ORG`. Local browser proof passed for secretary, data-management, and web-master role boundaries, the bounded roster with no personal-email leak to the denied role, and the read-only preview UI deliberately not submitted; no server-side Drive traffic proof is claimed. Hosted Development apply and role/browser acceptance remain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| CLEAN-022                    | Communications cancellation, leased/ambiguous outcomes, scheduler fairness, webhook quarantine, and unsubscribe privacy.                                                                   | `20260813020000_cancellation_preserves_unknown_delivery_outcomes.sql` leaves ambiguous deliveries reviewable, preserves their lapsed-lease reason, and reports `deliveriesLeftAmbiguous` beside `deliveriesSettled`; `csf_durable_communications.test.sql` carries 427 assertions over that split. Cancellation replays recompute current ambiguous-delivery and unexpired processing-lease counts under the campaign lock, and the cron route requires the settlement reserve plus the minimum provider window before acknowledging a scheduler reservation or advancing fairness. The root gitlink commit `8419171d` advanced the private submodule to `cdbeb59e6cc086e8794ec8b35157ab043f65c01c` (private `49266bf`, `c9dd245`, `fe799cd`, `e87d857`, and `cdbeb59e`), landing the officer-facing cancellation UX: `communications-actions.ts` types the outcome (`CsfCancellationOutcome`: `clean`, `ambiguous`, `leased`, `ambiguous_and_leased`) and builds its message; `components/CsfCommunicationsActions.tsx` closes the cancel dialog only for the `clean` outcome and renders the always-mounted, accessible `ActionStatus` polite status region with warning-styled toasts for non-clean outcomes; `components/CsfCommunicationsCampaigns.tsx` hosts that dialog per campaign card; focused private regression coverage lives in `lib/plugins/private/plugins/dvhs-csf/services/communications-actions.test.ts`. The superseded pre-publication record — "Source-complete at the repository-local/source-contract level, but not publishable" because the exact `cdbeb59e` target is local-only and not contained in the locally known private `origin/development`, so the strict root release check must fail until the private commit merges first, while full exact-tree local isolated replay, Docker-backed verification, hosted Development acceptance, provider/browser gates, and Production remain unverified and pending — is history: the private-first merge published `c33b9c2ac7f084d14daad5df999d5eda3a2c2ac1` (`c33b9c2`), the published private `development` head is now `b98dc77d89f988003baab238a8784a99719ac0ff` (`b98dc77`) with the root gitlink staged to it, the strict submodule containment and remote reachability gate passes, and the current-tree exact local isolated union replay passed. Hosted Development acceptance, provider/browser gates, and Production remain pending, provider behavior stays external, and source completion does not imply deployment or runtime database acceptance. Historical detail is retained in the superseded sections below. |
| AUD-003                      | Public function/catalog ACL posture.                                                                                                                                                       | Hosted catalog and advisor verification.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| AUD-012                      | Repeat notifications.                                                                                                                                                                      | Hosted repeated-notification acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| AUD-033-AI                   | Durable AI quota/idempotency receipts.                                                                                                                                                     | Hosted route/quota acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| AUD-015                      | Volunteer-hours authorization/concurrency.                                                                                                                                                 | Hosted provider/browser acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| AUD-019                      | Certificate publication ACL/forgery resistance.                                                                                                                                            | Hosted publication acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| AUD-020                      | Permanent plugin deletion.                                                                                                                                                                 | Hosted control-plane acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| AUD-021                      | Plugin uninstall without data deletion.                                                                                                                                                    | Hosted uninstall acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| AUD-HOURS-SERVICE            | Service-only hours publication.                                                                                                                                                            | Hosted advisor and browser ACL verification.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| AUD-003-ACL                  | Direct/effective relation and column ACL catalog.                                                                                                                                          | Hosted catalog/advisor verification.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| AUD-009-STORAGE              | Bucket/property/policy posture catalog.                                                                                                                                                    | Hosted storage verification.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| AUD-026                      | Public project-transaction wrapper hardening.                                                                                                                                              | Hosted advisors and transaction acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| AUD-027                      | Duplicate projects index.                                                                                                                                                                  | Hosted Performance Advisor verification.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| AUD-028                      | Staff authorization recheck under lock.                                                                                                                                                    | Hosted queued-revocation acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| AUD-029                      | Atomic CSF post replies and Pacific date boundary.                                                                                                                                         | Hosted reply/revocation/replay acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| AUD-036                      | Nine service-only CSF transactions in `20260813013200_recheck_csf_activity_partner_authorization_under_lock.sql` plus `20260813013300_close_csf_representative_and_publication_races.sql`. | Representative assignment and revocation use the same advisory and term row locks. The split 47+26 assertion autocommit dblink pgTAP suite remains focused evidence; the exact 292-migration/142-file replay passed 5,785 assertions. Hosted Development acceptance remains pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| AUD-030-ACTION               | Browser-reachable internal Server Actions.                                                                                                                                                 | Hosted build-manifest verification.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| AUD-038                      | Meeting-attendance database authorization recheck.                                                                                                                                         | Hosted migration/application parity.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| AUD-039                      | SQL/TypeScript meeting-import permission parity.                                                                                                                                           | Hosted migration/application parity.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| AUD-041                      | Server-written moderation reports and durable quota.                                                                                                                                       | Hosted route/database acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| AUD-042                      | `plugin_data` browser/default ACL closure.                                                                                                                                                 | Hosted advisor/unreachability verification.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| AUD-043                      | Private helper effective ACLs.                                                                                                                                                             | Hosted advisor verification after apply.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| AUD-022                      | Schedule, feedback, recurrence, and direct-write guards.                                                                                                                                   | Hosted lifecycle acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| AUD-023                      | Project lifecycle lock ordering.                                                                                                                                                           | Hosted cancellation/unreject/delete acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| AUD-024                      | Dangerous whole-table organization privileges.                                                                                                                                             | Hosted adversarial ACL verification.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| AUD-025                      | Organization username schema parity.                                                                                                                                                       | Hosted constraint/application acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| AUD-031-ORG                  | Inactive organization authorization.                                                                                                                                                       | Hosted organization acceptance; distinct from `AUD-031-MEETING`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| AUD-032                      | Direct project status transitions.                                                                                                                                                         | Hosted status-transition acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| AUD-033-RECURRENCE           | Recurrence generation/edit serialization and replay.                                                                                                                                       | Hosted recurrence acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| AUD-034                      | Cancellation-worker attempt accounting/fairness.                                                                                                                                           | Hosted worker acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| AUD-030-SIGNUP               | Atomic signup rejection and notification.                                                                                                                                                  | Hosted signup-rejection acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| CLEAN-023                    | Service-only CSF post-mutation outcome resolver in `20260814051720_csf_post_mutation_outcome_recovery.sql`.                                                                                | Locally fixed and reviewed: `plugin_data.csf_resolve_post_mutation_outcome(uuid,uuid,uuid)` rechecks `manage_posts` before and after the same per-request advisory lock and performs only a bounded immutable receipt read; its pgTAP suite and preflight T9 pass in the exact 292-migration/142-file replay with 5,785 assertions. Only hosted apply and acceptance remain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## External/provider and Production-only

| ID      | Classification      | Boundary                                                                                                      |
| ------- | ------------------- | ------------------------------------------------------------------------------------------------------------- |
| AUD-001 | Production-only     | Separate Production migration/application authorization and acceptance.                                       |
| AUD-002 | Production-only     | Separate Production migration/application authorization and acceptance.                                       |
| AUD-013 | Provider/Production | Provider credential ownership and Production acceptance are external to this Development repository closeout. |

## Outside P0–P2

| ID        | Priority | Boundary                                                                                    |
| --------- | -------- | ------------------------------------------------------------------------------------------- |
| CLEAN-020 | P3       | Private formatter-policy decision; explicitly outside this repository-owned P0–P2 closeout. |

## Historical Development closeout implementation snapshot — superseded

Everything below this heading is retained finding/evidence history. Its
`candidate`, `local`, `hosted`, `pending`, and exit-gate wording describes an
earlier checkpoint and is not current status. The authoritative current status
is the set of tables above.

This phase-one execution map began at exact root `8bab797839c27e7d9310ad6ee2ec0d977ab4341c`
and private gitlink `605342ca8a3f2d83c4a7b40abf60ba03b9f12b5b`. At that
checkpoint the integrated root ledger contained 290 migrations through
`20260814001123_csf_import_lineage_transport_settlement.sql`, and that exact
tree passed a complete isolated union replay on 2026-08-13: all 290 migrations,
140 pgTAP files, and 5,718 assertions passed, with 84 CSF tables present. Both
that run and the preceding 282-migration replay (133 pgTAP files, 5,523
assertions) are retained historical evidence; the current ledger and replay are
the 292-migration/142-file shape recorded at the top of this register. Hosted
Development remains at 273 migrations, and the Development alias serves older
code; a local replay does not establish hosted parity.

State key: **close** = exact repository implementation and named local evidence
already satisfy the repository-owned finding; **local** = implementation is
present but exact-tree local evidence is missing; **candidate** = a contained
candidate still needs reconciliation or implementation; **hosted** = repository
and local gates are sufficient and only Development/default-branch acceptance
remains; **external** = provider/account dependency; **Production-only** = not a
Development closeout item. Only the exact evidence named in this snapshot is
claimed passing.

| Item               | Owner                    | Source candidate / exact-tree source                                                                                                                                                   | State           | Active dependency                                                                 | Exit evidence                                                                                                                                                                                |
| ------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLEAN-004          | CSF lifecycle            | Private `605342ca`; lifecycle lineage                                                                                                                                                  | local           | Exact role/breakpoint accessibility run                                           | Zero critical axe plus keyboard and screen-reader proof                                                                                                                                      |
| CLEAN-005          | CSF lifecycle            | Root acceptance `1bb8576e` / aggregate `8beb56a7`                                                                                                                                      | candidate       | Reconcile only after import-lineage repair                                        | Synthetic mutation role matrix at desktop/tablet/phone                                                                                                                                       |
| CLEAN-006          | CSF identity/database    | Merged identity lineage through PR #144                                                                                                                                                | local           | Valid compiled merge refusal/success journeys                                     | Exact 290-migration/140-file replay passed 5,718 assertions; compiled browser journeys remain                                                                                                |
| CLEAN-007          | CSF applications         | Private `2ce0a3d`, already contained by `605342ca`                                                                                                                                     | hosted          | Hosted exact-code application decision journey                                    | Queue → detail → modal uses one current preflight                                                                                                                                            |
| CLEAN-008          | CSF posts                | Composer `b7edede8`, contained by private aggregate `cdbeb59e`                                                                                                                         | candidate       | Private publication and exact combined tests                                      | Every posting role reaches composer; partial-outcome tests                                                                                                                                   |
| CLEAN-009          | CSF invitations          | Migration `20260809211732` plus lifecycle candidate                                                                                                                                    | local           | Visible link lifecycle                                                            | Exact replay passed; link creation/renewal must visibly preserve delivery telemetry                                                                                                          |
| CLEAN-010          | CSF imports              | Root `20260814001123`; private import `0b3e32d2` in `cdbeb59e`                                                                                                                         | candidate       | Private-first publication                                                         | Exact 290 replay and valid lifecycle/RPC concurrency passed; private service blocker and browser tests remain                                                                                |
| CLEAN-011          | CSF UI                   | Private lifecycle/dialog lineage                                                                                                                                                       | candidate       | Reconcile private aggregate after database repair                                 | Pending/result, repeat suppression, focus, close, live-region tests                                                                                                                          |
| CLEAN-012          | CSF communications       | Communications aggregate `8beb56a7`                                                                                                                                                    | candidate       | Communications is last in integration order                                       | Reachable `manage_settings` recovery journeys                                                                                                                                                |
| CLEAN-013          | CSF identity             | Merged PR #144                                                                                                                                                                         | hosted          | Hosted account-connection acceptance                                              | Visible fail-closed corroboration journey                                                                                                                                                    |
| CLEAN-014          | CSF posts/privacy        | Private lifecycle candidate                                                                                                                                                            | candidate       | Private aggregate reconciliation                                                  | Member payload omits officer delivery state                                                                                                                                                  |
| CLEAN-015          | CSF release              | Merged publisher / PR #134                                                                                                                                                             | hosted          | Default-branch enabled invocation                                                 | Aggregate-only run and visible schedule → Feed; no email claim                                                                                                                               |
| CLEAN-017          | CSF database             | Merged `9984f232` / PR #140                                                                                                                                                            | local           | Hosted apply and visible Staff access/class-link refusals                         | Exact combined replay passed                                                                                                                                                                 |
| CLEAN-018          | CSF release              | Same staff/class-link series                                                                                                                                                           | hosted          | Hosted duplicate-link preflight                                                   | Named conflicts resolved through product, then successful apply                                                                                                                              |
| CLEAN-019          | CSF lifecycle            | Bounded private search in `605342ca`                                                                                                                                                   | local           | Representative synthetic scale                                                    | Reviewed `EXPLAIN (ANALYZE, BUFFERS)` and raised budget or correction UI                                                                                                                     |
| CLEAN-020          | CSF lifecycle            | Existing private tree                                                                                                                                                                  | external        | P3; outside the P0–P2 closeout                                                    | Separate private formatter-policy decision                                                                                                                                                   |
| AUD-001            | Production cutover       | Existing forward fix                                                                                                                                                                   | Production-only | Production authorization                                                          | Separate Production migration/app acceptance                                                                                                                                                 |
| AUD-002            | Production cutover       | Existing forward fix                                                                                                                                                                   | Production-only | Production authorization                                                          | Separate Production migration/app acceptance                                                                                                                                                 |
| AUD-003            | Platform database        | Merged `15ba4801` plus ACL catalog                                                                                                                                                     | local           | Later functions require exact-current catalog replay                              | Exact ACL replay, then hosted catalog/advisors                                                                                                                                               |
| AUD-004            | Plugin control plane     | Migration `20260810220300`                                                                                                                                                             | close           | Move stale row out of active section                                              | Existing constraint/action regression evidence retained                                                                                                                                      |
| AUD-006            | Platform notifications   | Merged server-client boundary                                                                                                                                                          | close           | Move stale row out of active section                                              | Admin-client and module-boundary tests retained                                                                                                                                              |
| AUD-012            | Platform notifications   | Merged PR #115                                                                                                                                                                         | hosted          | Hosted repeat-notification acceptance                                             | Repeated notices delivered without type-wide suppression                                                                                                                                     |
| AUD-033-AI         | Platform AI              | Merged PR #173                                                                                                                                                                         | hosted          | Hosted route/quota acceptance                                                     | Durable user/IP charge and exact idempotent replay                                                                                                                                           |
| AUD-013            | Account owner            | Provider credential                                                                                                                                                                    | external        | Production credential owner                                                       | Separate provider/Production acceptance                                                                                                                                                      |
| AUD-014            | Integration order        | Merged lifecycle-before-audit order                                                                                                                                                    | close           | Move stale row out of active section                                              | Ordered ledger is already present in Development                                                                                                                                             |
| AUD-015            | Platform hours           | Merged hours series                                                                                                                                                                    | local           | Later `20260813013100` restates authorization                                     | Exact replay/concurrency, then hosted provider/browser                                                                                                                                       |
| AUD-016            | DV private plugin        | Private PR #20 / root PR #122                                                                                                                                                          | close           | Move stale row out of active section                                              | Recorded exact CI/build/browser run retained                                                                                                                                                 |
| AUD-017            | Paper signup             | Root PR #123                                                                                                                                                                           | close           | Move stale row out of active section                                              | Recorded exact clean build/CI run retained                                                                                                                                                   |
| AUD-018            | DV guardian              | Root PR #124                                                                                                                                                                           | close           | Move stale row out of active section                                              | Recorded exact CI/browser run retained                                                                                                                                                       |
| AUD-019            | Platform certificates    | Merged PR #143                                                                                                                                                                         | local           | Hosted publication acceptance                                                     | Exact 290 replay passed the ACL/forgery pgTAP coverage                                                                                                                                       |
| AUD-020            | Plugin deletion          | Merged PRs #145/#154                                                                                                                                                                   | hosted          | Reviewed private manifest completeness                                            | Hosted permanent-deletion control-plane acceptance                                                                                                                                           |
| AUD-021            | Plugin uninstall         | Same control-plane series                                                                                                                                                              | hosted          | Hosted uninstall acceptance                                                       | Data retained and no lifecycle hook invoked                                                                                                                                                  |
| AUD-HOURS-SERVICE  | Platform hours           | `20260812101000`                                                                                                                                                                       | local           | Browser ACL catalog and hosted advisor verification                               | Exact combined replay passed the service-role-only publication RPC coverage                                                                                                                  |
| AUD-003-ACL        | Platform database        | `20260812100900`                                                                                                                                                                       | local           | Hosted catalog/advisor verification                                               | Exact combined replay passed direct/effective relation and column-ACL coverage                                                                                                               |
| AUD-009-STORAGE    | Platform storage         | `20260812100800`                                                                                                                                                                       | local           | Hosted storage verification                                                       | Exact combined replay passed bucket/property/policy catalog coverage                                                                                                                         |
| AUD-026            | Project lifecycle        | `20260812104754`                                                                                                                                                                       | local           | Later project wrappers affect boundary                                            | Exact replay/advisors, then hosted acceptance                                                                                                                                                |
| AUD-027            | Platform database        | `20260812104754`                                                                                                                                                                       | hosted          | Hosted Performance Advisor                                                        | Canonical constraint index only                                                                                                                                                              |
| AUD-028            | CSF staff access         | Merged PR #160                                                                                                                                                                         | hosted          | Hosted queued-revocation journeys                                                 | Under-lock denial with zero target/audit mutation                                                                                                                                            |
| AUD-029            | CSF posts                | `20260812152300` plus private reply actions                                                                                                                                            | hosted          | Exact application deployment                                                      | Reply/revocation/replay hosted acceptance                                                                                                                                                    |
| AUD-036            | CSF activities/clubs     | Nine service-only CSF transactions in `20260813013200_recheck_csf_activity_partner_authorization_under_lock.sql` + `20260813013300_close_csf_representative_and_publication_races.sql` | local           | representative assignment and revocation use the same advisory and term row locks | The split 47+26 assertion autocommit dblink pgTAP suite remains focused evidence; exact 290-migration/140-file replay passed 5,718 assertions; Hosted Development acceptance remains pending |
| AUD-037            | CSF private plugin       | Private `opportunities.ts` / `partner-clubs.ts`                                                                                                                                        | candidate       | Remove outcome-claiming prefixes private-first                                    | Private contract/browser review, then root gitlink and hosted                                                                                                                                |
| AUD-030-ACTION     | Platform action boundary | Merged PR #167                                                                                                                                                                         | hosted          | Hosted build-manifest verification                                                | Only reviewed Server Actions remain reachable                                                                                                                                                |
| AUD-031-MEETING    | CSF meetings             | Private `605342ca`; root PR #177                                                                                                                                                       | local           | Compiled role/browser journeys                                                    | Exact-code hosted meeting acceptance                                                                                                                                                         |
| AUD-038            | CSF meetings             | `20260812220000`                                                                                                                                                                       | hosted          | Hosted migration/application parity                                               | Under-lock exact attendance-correction permission recheck                                                                                                                                    |
| AUD-039            | CSF imports              | `20260812220000`                                                                                                                                                                       | hosted          | Hosted migration/application parity                                               | SQL and TypeScript both require exact meeting permissions                                                                                                                                    |
| AUD-040            | CSF meetings             | Private `049e362`, contained by `605342ca`                                                                                                                                             | close           | Move stale row out of active section                                              | Bounded term search, limit 20, no personal email                                                                                                                                             |
| AUD-041            | Platform moderation      | Merged PR #174                                                                                                                                                                         | hosted          | Hosted migration/route acceptance                                                 | Server-written reports, bounded replay and quota proof                                                                                                                                       |
| AUD-042            | Plugin database          | Merged PR #174                                                                                                                                                                         | hosted          | Hosted advisor/unreachability verification                                        | Browser roles cannot reach current/future plugin objects                                                                                                                                     |
| CLEAN-021          | Project cancellation     | Merged PRs #156/#158                                                                                                                                                                   | local           | Hosted recovery acceptance                                                        | Exact 290 replay passed snapshot-ledger, worker-fairness, lock, and recovery coverage                                                                                                        |
| AUD-022            | Project lifecycle        | `20260812100200`/`20260812100300`                                                                                                                                                      | local           | Hosted schedule/feedback/recurrence acceptance                                    | Exact combined replay passed focused database coverage                                                                                                                                       |
| AUD-023            | Project lifecycle        | Merged project series                                                                                                                                                                  | local           | Hosted lifecycle acceptance                                                       | Exact 290 replay passed cancellation/unreject/parent-delete database coverage                                                                                                                |
| AUD-024            | Platform organizations   | `20260812100000`                                                                                                                                                                       | local           | Exact combined ACL replay                                                         | Adversarial relation ACL proof, then hosted                                                                                                                                                  |
| AUD-025            | Platform organizations   | Same slug lineage                                                                                                                                                                      | local           | Exact schema/action/fixture gates                                                 | Historical plus hosted constraint validation                                                                                                                                                 |
| AUD-031-ORG        | Platform organizations   | `20260813013000`/`20260813013100`                                                                                                                                                      | local           | Hosted organization acceptance                                                    | Exact replay passed inactive/null/cross-tenant pgTAP coverage                                                                                                                                |
| AUD-032            | Project lifecycle        | `20260813013100`                                                                                                                                                                       | local           | Hosted status-transition acceptance                                               | Exact 290 replay passed direct-write denial, receipt, rollback, and concurrency coverage                                                                                                     |
| AUD-033-RECURRENCE | Project lifecycle        | `20260813013000`/`20260813013100`                                                                                                                                                      | local           | Exact two-session run                                                             | Generation/end/replay proof, then hosted                                                                                                                                                     |
| AUD-034            | Project cancellation     | Merged worker fix                                                                                                                                                                      | local           | Hosted worker acceptance                                                          | Exact 290 replay passed budget/refund/reaper coverage                                                                                                                                        |
| AUD-030-SIGNUP     | Project lifecycle        | `20260812161500`                                                                                                                                                                       | local           | Later `20260813013100` affects related paths                                      | Exact replay/atomic notification proof, then hosted                                                                                                                                          |

The preserved candidate map is intentionally non-writing: private aggregate
`cdbeb59e` contains the accepted import through `0b3e32d2` and composer through
`b7edede8`; root aggregate `8beb56a7` contains acceptance `1bb8576e`,
architecture `9754db33`, operator docs `7ee4f9e1`, and the reconciled
communications line `e9346dc`, and pins `cdbeb59e`. Neither is upstream.
Do not integrate them until the root import-lineage repair is independently
accepted. Do not use `a5fee979`: it contains unrelated stale local-development
lineage and pins missing private object `398bc033`. Six later retry-lineage
commits ending at private `be2d6432` are not part of the accepted `0b3e32d2`
handoff or either aggregate and require separate review.

The root import-lineage repair is now present in accepted forward migration
`20260814001123_csf_import_lineage_transport_settlement.sql`. It places begin
behind the same identity-first lock and under-lock authorization order as commit,
removes the caller-selected six-argument failure overload, exposes only the
five-argument unknown-only transport settlement to `service_role`, and preserves
database-derived retry lineage. Focused source, database, ACL/signature, and real
supported-lifecycle concurrency evidence is accepted. The historical fixture
that directly constructed lifecycle-owned state remains invalid and is not
counted. No exact full isolated replay or hosted Development apply was claimed
by the earlier snapshot. The current exact integrated replay passes all 292
migrations, 142 pgTAP files, and 5,785 assertions with 84 CSF tables. Hosted
Development apply remains unverified.

Register defects to correct during closeout: `AUD-030`, `AUD-031`, and
`AUD-033` are duplicate identifiers, so this snapshot uses scoped suffixes;
the P0–P2 section contains P3 `CLEAN-020`; several rows still say merged
implementations are unmerged; and completed repository rows `AUD-004`,
`AUD-006`, `AUD-014`, `AUD-016`, `AUD-017`, `AUD-018`, and `AUD-040` remain in
the active table. Status moves happen only with the named evidence, not from
this inventory alone.

## Historical finding detail — superseded

| ID        | Priority | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Owner                      | Evidence / exit gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLEAN-004 | P1       | Fix the lifecycle audit's critical control names, ARIA relationships, nested interactive controls, contrast, focus, keyboard, reduced-motion, and screen-reader defects across CSF roles and breakpoints.                                                                                                                                                                                                                                                                                                                | CSF lifecycle overhaul     | Zero critical axe findings plus keyboard/screen-reader evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| CLEAN-005 | P1       | Complete visible synthetic CSF mutation lifecycle for profile claim/resolution, imports, applications, points, meetings/clubs, close/reopen, communications, and reports.                                                                                                                                                                                                                                                                                                                                                | CSF lifecycle overhaul     | Role matrix at desktop/tablet/phone                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| CLEAN-006 | P0       | Profile merge could preview readiness while execution missed later profile references or collided with active point claims; global identity table locks could serialize unrelated chapters or deadlock with edit/claim paths.                                                                                                                                                                                                                                                                                            | CSF lifecycle overhaul     | Implementation candidate only; prior acceptance was invalidated by independent hostile review. The amended unmerged migration catalogs all exact-current-schema profile FKs plus candidate arrays; classifies atomic rewrites, immutable history, and blockers; rewrites direct invitations, corrections, current representatives, preferences, prior tombstones, and all earlier ownership; makes every profile-key uniqueness rule canonical in preview/execution, including active point claims, active staff assignments, and open point appeals; uses one organization-first identity advisory hierarchy; removes global merge/connection table locks; and aborts unless zero unintended live source references remain. Authored evidence now includes exact-catalog and point-state pgTAP, a production-shaped success spanning accounts/invitations/applications/points/evidence/meetings/corrections/representatives/preferences/history/audit, real dblink same/cross-organization edit/claim interleavings, and a visible successful-merge journey. None is claimed passing here: mandatory exit gate is a fresh isolated migration replay plus the full pgTAP suite, focused pure/static gates, compiled browser refusal + success journeys, and then hosted Development acceptance. |
| CLEAN-007 | P0       | Application detail and decision modal can report ready/all-green while academic evidence is failed, missing, stale, or internally contradictory.                                                                                                                                                                                                                                                                                                                                                                         | CSF lifecycle overhaul     | One server preflight proven in queue/detail/modal and DB tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| CLEAN-008 | P1       | `manage_posts` templates can lack a reachable composer, and a persisted post can be reported unsaved when its settings-only campaign request fails.                                                                                                                                                                                                                                                                                                                                                                      | CSF lifecycle overhaul     | Every posting role reaches composer; partial outcome tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| CLEAN-009 | P1       | Direct invitation link creation/renewal changes sent-at and resend telemetry without sending or durably queueing email.                                                                                                                                                                                                                                                                                                                                                                                                  | CSF lifecycle overhaul     | Forward migration and link-vs-delivery regression coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| CLEAN-010 | P1       | Failed or incomplete import jobs can display ready/no-conflict copy and an enabled commit action because UI readiness diverges from server blockers.                                                                                                                                                                                                                                                                                                                                                                     | CSF lifecycle overhaul     | Shared server blocker contract in service and browser tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| CLEAN-011 | P1       | Mutating dialogs can require a silent first click, remain open after success, accept repeats, or lose a clear success/error announcement.                                                                                                                                                                                                                                                                                                                                                                                | CSF lifecycle overhaul     | Shared pending/result behavior and focused interaction tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| CLEAN-012 | P1       | CSF communications configuration is directed to an inaccessible private-plugin settings surface, and unknown/quarantined delivery outcomes have no officer reconciliation UI.                                                                                                                                                                                                                                                                                                                                            | CSF lifecycle overhaul     | Reachable `manage_settings` flow and recovery acceptance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| CLEAN-013 | P0       | Officer resolution of an account-connection request could connect a same-named classmate: the queue offered a one-click connect and the resolve RPC required no corroborating identity attribute.                                                                                                                                                                                                                                                                                                                        | CSF lifecycle overhaul     | Locally fixed and accepted: the database recomputes confirmed-email, exact-name, and single-active-cohort corroboration under locks; the UI treats ranking as review context and fails closed. The fresh isolated 4,292-assertion replay includes the focused corroboration suite. A compiled synthetic Chromium journey visibly navigated Members → Account connections, showed `Review only` and `Connection unavailable`, omitted `Connect account`, permitted an audited rejection, and verified both the rejected request and absence of a linked account. Hosted Development acceptance is still pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| CLEAN-014 | P1       | Member feed and stream payloads carried officer email-delivery state for every post, hidden only by conditional rendering.                                                                                                                                                                                                                                                                                                                                                                                               | CSF lifecycle overhaul     | Payload omits the field unless post authority is re-derived                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| CLEAN-015 | P1       | The due-post publisher, hold recovery, route, pgTAP, central replay, and repository-owned GitHub scheduler are implemented. PR #134 is on Development and the visible composer schedule/readback/archive lifecycle passed, but the scheduler has not reached the default branch or produced an enabled hosted invocation and visible schedule → Feed publication.                                                                                                                                                        | CSF release/infrastructure | Default-branch release with exact Production opt-in, successful aggregate-only scheduled invocation, visible synthetic schedule → Feed proof, and no scheduled-email claim                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| CLEAN-017 | P1       | The CSF staff-access recovery floor and one-active-class-invitation rule pass the complete generated isolated migration replay and pgTAP suite, but the exact combined root/private commit, hosted Development apply, and visible officer journeys are not yet accepted.                                                                                                                                                                                                                                                 | CSF database               | Generated isolated Supabase replay passed all 93 database files and 3,998 assertions, including `csf_staff_recovery_seat_floor.test.sql` (41 assertions), `csf_cohort_link_uniqueness.test.sql` (24 assertions), and the amended `csf_atomic_onboarding_links`, `csf_atomic_profile_claims`, and `csf_atomic_profile_link_requests`; close only after the private-first gitlink integration, exact combined replay/CI, hosted Development migration, and visible Staff access/class-link acceptance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| CLEAN-018 | P2       | `csf_onboarding_links_active_cohort_uidx` fails the migration closed when a chapter already holds two active reusable links for one class and semester. The preflight names every conflicting organization, class, semester, and code and deletes nothing, so an operator must deactivate the extras through Members → Account connections first.                                                                                                                                                                        | CSF release/infrastructure | Before applying to hosted Development or Production, run the preflight query, resolve any named conflict through the product's own deactivate action, and re-run the migration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| CLEAN-019 | P2       | The student-specific link picker resolves email ownership against the whole roster with a bounded probe. When one page carries more than 25 addresses whose ownership is still ambiguous after a truncated read, the addresses past that budget fail closed and are not offered until the duplicate roster records are corrected.                                                                                                                                                                                        | CSF lifecycle overhaul     | Reproduce at representative synthetic scale, review `EXPLAIN (ANALYZE, BUFFERS)` for the ownership probe, and either raise the recheck budget with evidence or surface the affected records in the officer correction queue                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| CLEAN-020 | P3       | 64 pre-existing files in the private submodule are not Prettier-formatted. The root `.prettierignore` excludes `lib/plugins/private/`, so no gate enforces the private tree and this change formatted only the files it touched.                                                                                                                                                                                                                                                                                         | CSF lifecycle overhaul     | Decide whether the private repository adopts the same formatter gate, then format the whole private tree in one dedicated commit so the sweep is separable from behavior changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| AUD-001   | P0       | `public.trusted_member` INSERT policy has no `status` guard, so a user can self-grant trusted status and unlock organization and project creation.                                                                                                                                                                                                                                                                                                                                                                       | Production cutover         | Forward migration with two guards plus `trusted_member_self_grant.test.sql`; live in Production until cutover                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| AUD-002   | P0       | `public.notifications` INSERT policy ends in `OR (auth.uid() IS NULL)`, letting any unauthenticated caller inject notifications for any user.                                                                                                                                                                                                                                                                                                                                                                            | Production cutover         | Server callers moved off the browser client, disjunct removed, `notifications_rls.test.sql`; live in Production until cutover                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| AUD-003   | P1       | `public` default privileges granted `anon`/`authenticated` on every future table and function. The reviewed callable catalog is now exact and unexpected effective function grants fail CI.                                                                                                                                                                                                                                                                                                                              | Hosted Development         | Merged as `15ba480`; exact Vercel Development deployment READY and Supabase Preview passed; shared Development catalog and advisors pending because the connector currently exposes only Production                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| AUD-004   | P1       | `plugin_audit_logs_action_check` allows 22 action values while the code emits 28, so six lifecycle events, including plugin data deletion, go unaudited.                                                                                                                                                                                                                                                                                                                                                                 | Plugin control plane       | Forward migration with all values; audit writes no longer swallow the constraint error                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| AUD-006   | P2       | Three `server-only` modules drove notifications through the browser Supabase client, which is why the AUD-002 escape hatch existed.                                                                                                                                                                                                                                                                                                                                                                                      | Platform                   | Server callers use the admin client; module-boundary test forbids the browser client                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| AUD-012   | P2       | The browser notification service suppresses any notification whose `(user_id, type)` pair already exists, so repeat notices are silently dropped.                                                                                                                                                                                                                                                                                                                                                                        | Platform                   | Fixed locally: optional dedupe key, no type-wide suppression, replay-safe browser/server results, 17 unit tests, and 8 pgTAP assertions; hosted Development pending                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| AUD-033   | P1       | The authenticated waiver-analysis route accepted a 20 MB PDF and could make two provider AI calls without consuming the platform's durable user/IP quota; generic and vision-fallback failures also returned or logged raw exception messages.                                                                                                                                                                                                                                                                           | Platform AI                | Fixed locally with one service-role-only transactional user/IP charge, durable hashed idempotency receipts, exact replay after unknown RPC outcomes, content-bound request identities, no shared unresolved-IP bucket, and executing route tests proving auth/quota denial precedes multipart, PDF, and provider work. The forward migration explicitly denies table access and client RPC execution, so the RPC is intentionally absent from the anon/authenticated catalog. Fail-closed 503, bounded 429 `Retry-After`, non-Production-only E2E bypass isolation, and error-class-only handling remain enforced; hosted Development acceptance remains pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| AUD-013   | P2       | `RESEND_API_KEY` is flagged "Needs Attention" on both Production and Pre-Production in Vercel; email delivery is load-bearing for CSF campaigns, waiver notices, and certificates.                                                                                                                                                                                                                                                                                                                                       | Account owner              | Development credential resolved and verified before hosted acceptance; Production remains a separate release gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| AUD-014   | P2       | The lifecycle migrations had to precede the five later audit migrations in the first hosted apply.                                                                                                                                                                                                                                                                                                                                                                                                                       | Merge order                | Merge lifecycle work into `development` before any hosted migration push and verify ordered dry-run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| AUD-015   | P1       | Volunteer-hours publication trusted client identity fields and split certificate, publish-state, notification, and email work across non-atomic writes; retries could duplicate certificates and same-name volunteers could receive the wrong notification.                                                                                                                                                                                                                                                              | Platform hours publication | Fixed locally: permission-rechecked transactional RPC, conflict-aborting unique index, conflict-tolerant supplemental issuance, canonical session key, signup/membership locks, receipt/outbox, immutable hashed provider payload, wall-clock first-attempt-anchored 24-hour recovery window reset only after proven pre-send failure with no earlier ambiguous attempt, lease-aware boundary recovery, explicit retry drain, idempotent settlement, 53 focused pgTAP assertions, 16 action/outcome plus 5 duration tests, and deterministic multi-session replay/window-crossing/status/revocation/supplemental-race proof; exact hosted Development gates pending                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| AUD-016   | P1       | The private DV form-editor preview inserted persisted rich-text help content through a direct HTML sink, allowing stored executable markup to run for another editor.                                                                                                                                                                                                                                                                                                                                                    | DV form editor             | Fixed by private PR #20 at `711c848` and root PR #122 at `5ad8cc7`; exact run `31480704997` passed quality/build, replay, pgTAP, cron no-egress, DV/CSF browser gates, trace validation, and owned teardown                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| AUD-017   | P1       | The paper-signup AI route exported an unsupported value, so clean isolated Next production builds failed route-module type validation and blocked DV/CSF browser acceptance.                                                                                                                                                                                                                                                                                                                                             | Paper signup route         | Fixed by PR #123 at `f6a0931`; exact run `31479507620` passed quality, clean build, replay, pgTAP, cron no-egress, DV/CSF browser gates, and owned teardown                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| AUD-018   | P1       | Hydration could replace a guardian's reviewed availability and notes with server-rendered defaults immediately before the single-use Server Action submission, which then displayed success for the wrong data.                                                                                                                                                                                                                                                                                                          | DV guardian form           | Fixed by PR #124 at `e830fdf`; exact run `31483374291` passed quality/build, replay, pgTAP, cron no-egress, DV/CSF browser gates, trace validation, and owned teardown                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| AUD-019   | P0       | Every `public.certificates` write policy ended in `(type = 'verified' AND auth.uid() = creator_id)`, a branch the writer satisfies by choosing its own row values, so any authenticated holder of the public anon key could mint verified certificates for themselves and, against `certificates_verified_signup_unique`, squat a verified row on a victim's signup and permanently block that project session's publication. `authenticated` and `anon` also held a `TRUNCATE` grant, which RLS does not govern at all. | Platform certificates      | Fixed locally by `20260811180000_close_certificate_verification_forgery`: the verified and project-creator branches are removed from INSERT/UPDATE/DELETE; INSERT and UPDATE pin self-reported writes on both sides of the transition (type, owner, creator, project, signup, certification, and, on the new row, check-in method), while DELETE deliberately keeps only the narrower baseline check (type and owner) so an existing self-reported row stays deletable by its author -- it does not pin the rest of the envelope. anon write plus `TRUNCATE` grants are revoked. Verified issuance stays exclusively on the organization-scoped, atomic `publish_volunteer_hours_transactional` path, whose `authenticated` EXECUTE grant and every SECURITY DEFINER ACL are untouched. Evidence: 33 adversarial pgTAP assertions that drive the table as the real `authenticated` and `anon` roles, 16 of which fail when the migration is withheld; 7 source-inventory tests; isolated replay PASS at 249 migrations, 99 files, 4244 assertions. Hosted Development gates pending.                                                                                                                                                                                                            |
| AUD-020   | P2       | Permanent plugin-data erasure had no product caller, authorization boundary, complete manifest contract, or replay-safe receipt.                                                                                                                                                                                                                                                                                                                                                                                         | Plugin control plane       | Fixed locally: a separate MFA-aware organization-admin action revalidates membership, registry, catalog, entitlement, forced/private state, uninstall state, and organization/plugin-bound confirmation under the transition lease; complete manifest declarations fail closed; globally bound claim-token receipts distinguish processing, retryable failure, success, and reconciliation; hook completion is durable before independent redacted audit attachment. No private manifest declares the new complete contract yet, so permanent deletion remains unavailable for private plugins until a separate private-repository review lands. Hosted Development remains pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| AUD-021   | P2       | Ordinary uninstall could execute arbitrary `onUninstall` code before removing the install row, so the platform could not guarantee retained plugin data.                                                                                                                                                                                                                                                                                                                                                                 | Plugin control plane       | Fixed locally: the ordinary uninstall branch mechanically calls only the exact install-row removal callback, never lifecycle code or `plugin_data`; compensation after a failed install may still invoke `onUninstall`, but that is not the organization uninstall action. Audit/UI behavior tests assert `pluginDataRetained: true`, exact tenant retention, idempotent repeat uninstall, and no lifecycle invocation. Hosted Development remains pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Integrated volunteer-hours finding

| ID                | Priority | Finding                                                                                                                                                                        | Owner                      | Evidence / exit gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUD-HOURS-SERVICE | P1       | The authenticated REST `EXECUTE` capability on the public SECURITY DEFINER volunteer-hours publication function left a consequential publication transaction browser-callable. | Platform hours publication | `20260812101000_move_volunteer_hours_publication_to_service_boundary.sql` drops the four-argument authenticated overload, keeps the transaction private with a fixed path, exposes a fixed-path SECURITY INVOKER five-argument wrapper to `service_role` only, and has the Server Action supply the actor from its validated session while preserving receipt/outbox replay. The browser ACL catalog must retain project cancellation and capacity-aware unrejection, remove the old hours RPC, and never add the service-only wrapper. Focused source/pgTAP coverage is present; exact combined replay and hosted advisor verification remain pending. |

### Integrated architecture findings

| ID              | Priority | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Owner                      | Evidence / exit gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AUD-003-ACL     | P1       | Future-object default privileges and historical existing-object relation/column ACL residue are separate exposure paths; `PUBLIC`, inherited grants, and dangerous whole-table privileges must not sit outside the reviewed browser contract.                                                                                                                                                                                                                                                                                                                                                                                                           | Platform database security | Retain `20260812100900_public_client_relation_acl_catalog.sql`, the bidirectional direct/effective relation and `pg_attribute.attacl` catalog checks, identifier-safe regrants, zero dangerous/`PUBLIC` residue, shared pgTAP/source contracts, and exact combined replay before closure.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| AUD-009-STORAGE | P1       | Storage drift checks could miss unexpected buckets and broad client-reachable policies, including policies that reach server-only buckets.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Platform storage security  | Retain `20260812100800_client_acl_and_storage_posture_catalogs.sql`, all eleven reviewed buckets and posture classes, exact canonical `pg_policy` shape, bidirectional bucket/property comparison, zero client policies on server-only buckets, exact private-client policy coverage, and the deferred exact replay/hosted verification boundary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| AUD-026         | P1       | Authenticated clients could execute the public SECURITY DEFINER project-cancellation and capacity-aware unrejection transactions through the Data API, producing two Supabase Security Advisor warnings despite their internal authorization rechecks.                                                                                                                                                                                                                                                                                                                                                                                                  | Platform project lifecycle | `20260812104754_harden_project_transaction_rpc_boundaries.sql` must preserve both public signatures as fixed-path SECURITY INVOKER wrappers over unexposed fixed-path private transactions, with exact ACL and authorized/unauthorized pgTAP coverage; close only after exact local replay/audit and hosted Development advisors are clean.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| AUD-027         | P2       | `public.projects` carried the constraint-owned `projects_id_organization_id_key` and a structurally identical standalone `projects_id_organization_id_uidx`, producing a duplicate-index Performance Advisor warning.                                                                                                                                                                                                                                                                                                                                                                                                                                   | Platform database          | Verify the canonical constraint/index and foreign-key dependencies, drop only the dependency-free standalone index in `20260812104754_harden_project_transaction_rpc_boundaries.sql`, and require focused pgTAP plus exact local replay and hosted Development advisor verification before closure.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| AUD-028         | P1       | A staff-only actor could authorize a role edit or position revocation, wait behind the organization staff-access lock, and then continue after a committed mutation removed their `manage_roles` capability.                                                                                                                                                                                                                                                                                                                                                                                                                                            | CSF staff access           | `20260812114638_recheck_csf_staff_authorization_under_lock.sql` keeps the stable service-only RPC signatures, moves the existing logic behind owner-only implementations, and rechecks authorization after acquiring the shared organization lock. Real dblink pgTAP races must prove both queued mutations fail with zero target or audit mutation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| AUD-029         | P1       | CSF follow-up add/delete used separate application reads, row writes, and audit writes; a lost response could duplicate an add, a process failure could omit history, staff revocation could race a queued mutation, and the table did not itself bind a reply tenant to its parent post tenant. The shared permission helper also evaluated position dates with session `current_date`, so a non-Pacific database session could authorize or deny at the wrong chapter-day boundary.                                                                                                                                                                   | CSF posts                  | `20260812152300_atomic_csf_post_replies.sql` adds and validates the composite tenant FK, restricts both parent-delete paths, removes every direct service-role write/DDL privilege, extends the reviewed plugin teardown without changing its public contract, exposes one service-only fixed-path transaction with stable request receipts, post-lock authorization, row locking, author-or-admin delete enforcement, explicit ACLs, and no raw reply text in audit, and makes the existing permission helper evaluate position windows with `csf_chapter_today()`. Audited source evidence remains 48 focused private tests, 47 existing adversarial transaction/ACL pgTAP assertions, 10 real two-connection replay/revocation assertions, and a complete 121-file replay; 4 additional Pacific chapter-day assertions under a deliberately mismatched session timezone await the exact integrated-branch replay, and hosted Development acceptance remains required before closure.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| AUD-036         | P1       | Nine service-only CSF transactions carrying `manage_opportunities` or `manage_partner_clubs` authority checked mutable staff permission before their request and business locks, so a queued call could continue after a committed role edit, staff-position revocation, or host-membership change removed that authority. Activity publication could also interleave with term closure and publish into a term that had closed while the request waited.                                                                                                                                                                                               | CSF activities and clubs   | `20260813013200_recheck_csf_activity_partner_authorization_under_lock.sql` preserves the original seven stable signatures and moves their prior transaction bodies behind owner-only implementations. `20260813013300_close_csf_representative_and_publication_races.sql` extends the same owner-only implementation, `csf_staff_access_lock_key`, active-membership `FOR SHARE`, and under-lock permission recheck to representative assignment and revocation, and serializes publication with term closure using the same advisory and term row locks plus an under-lock open-term recheck. The repair is intentionally ordered after #174 and #158 and does not restate either dependency's definitions. All nine wrappers retain their exact signatures and service-role-only ACLs; implementations remain owner-only, with the replaced publication implementation's reviewed `postgres` grant stated explicitly after its revoke. Local evidence is 25 focused source contract tests (319 assertions), a split 47+26 assertion autocommit dblink pgTAP suite covering zero target and zero receipt writes plus positive controls, and publish-vs-close coverage. The full local isolated replay passed all 133 pgTAP files and 5,523 assertions against 282 migrations. Hosted Development acceptance remains pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| AUD-037         | P2       | Four of the seven private CSF Server Action call sites wrap the database authorization denial in a `Failed to save…`/`Failed to update…` prefix (`createCsfOpportunityAction`, `updateCsfOpportunityAction`, `setCsfActivityStatusAction`, `createCsfPartnerClubAction`). Under the AUD-036 replay change that prefix can be read as "the write did not happen" when the original request is in fact already durable.                                                                                                                                                                                                                                   | CSF plugin (private repo)  | Repository-side scope is closed: every one of the seven call sites propagates the database sentence verbatim into the action result, none converts a denial into success, and `supabase/tests/contracts/csf_activity_partner_authorization_lock_source.test.ts` pins that. Remediation must land in the private plugin repository first (`lib/plugins/private/plugins/dvhs-csf/server/actions/opportunities.ts` and `partner-clubs.ts`), replacing the outcome-claiming prefix with an authorization-lost message that does not assert whether the earlier request committed; the root gitlink advances only after that merges. Not fixable from this repository and intentionally untouched here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| CLEAN-022       | P1       | Six CSF communications defects crossed cancellation, dispatch fairness, transport classification, webhook recovery, and unsubscribe privacy: cancellation could overwrite ambiguous delivery evidence; the scheduler could abandon later tenants or start without a usable provider window; a provably pre-send abort could be recorded as unknown; webhook quarantine could lose signed coordinates or mishandle foreign-environment/permanent faults; configuration errors could expose secret names; and GET-based consent mutation let link scanners change state while the page echoed requested rather than durable state.                        | CSF communications         | `20260813020000_cancellation_preserves_unknown_delivery_outcomes.sql` leaves ambiguous deliveries reviewable, preserves their lapsed-lease reason, and reports `deliveriesLeftAmbiguous` beside `deliveriesSettled`; `csf_durable_communications.test.sql` contains 427 assertions covering that split. Cancellation replays recompute current ambiguous-delivery and unexpired processing-lease counts under the campaign lock. The cron route skips tenants already found empty and requires the settlement reserve plus the minimum provider window before acknowledging a scheduler reservation or advancing fairness; pre-send aborts remain retryable; signed webhook evidence is quarantined or ignored by exact environment without leaking configuration; and unsubscribe GET only renders while POST reports the ledger verdict. **Source-complete at the repository-local/source-contract level, but not publishable:** root gitlink commit `8419171d` advances the private submodule to exact commit `cdbeb59e6cc086e8794ec8b35157ab043f65c01c` (private `49266bf`, `c9dd245`, `fe799cd`, `e87d857`, and `cdbeb59e`), landing the previously pending officer-facing cancellation UX: `communications-actions.ts` types the outcome (`CsfCancellationOutcome`: `clean`, `ambiguous`, `leased`, `ambiguous_and_leased`) and builds its message; `components/CsfCommunicationsActions.tsx` closes the cancel dialog only for the `clean` outcome, renders the always-mounted, accessible `ActionStatus` polite status region, and uses warning-styled toast semantics for every non-clean outcome (success only for `clean`); `components/CsfCommunicationsCampaigns.tsx` hosts that dialog per campaign card. Focused private regression coverage lives in `lib/plugins/private/plugins/dvhs-csf/services/communications-actions.test.ts`. The exact `cdbeb59e` target is local-only and not contained in the locally known private `origin/development`, so the strict root release check must fail until the private commit merges first and the local remote-tracking ref reflects that merge. No email was sent and no provider or Production surface was touched. This source-complete label is not a release closure: full exact-tree local isolated replay, Docker-backed verification, hosted Development acceptance, provider/browser gates, and Production remain unverified and pending, and it does not imply deployment or runtime database acceptance. |
| AUD-030         | P0       | Four waiver-persistence helpers and one project-access helper were directly POST-reachable because they were exported from file-level `"use server"` modules; service-role storage and signature writes made the waiver blast radius every project/signup and waiver bucket.                                                                                                                                                                                                                                                                                                                                                                            | Platform action boundary   | Confirmed with high confidence by the generated source inventory, failing AST boundary test, and clean baseline compiled Server Action manifest. Fixed locally by moving the waiver helpers unchanged to server-only `waiver-persistence.ts` and the access helper to server-only `access-helpers.ts`, while preserving reviewed public actions and signup call sites. The fixed build manifest retains only the two reviewed waiver actions; hosted Development is unverified and Production was untouched.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| AUD-031         | P1       | CSF meeting scheduling and cohort views could query and serialize active-student identity options even when the actor lacked attendance-reconciliation authority; hidden meeting-import preview payloads exposed submitted identity fields, and directly callable preview/commit plus generic row-recovery actions accepted broader legacy import grants.                                                                                                                                                                                                                                                                                               | CSF meetings               | Private PR #46 merged the implementation as `fbd18fa`; maintainability follow-up PR #47 produced meeting follow-up `4f20fa5`, historically contained by private `development` `605342ca8a3f2d83c4a7b40abf60ba03b9f12b5b` and also present in the current root gitlink `cdbeb59e`; that current target is local-only and release-blocked until its private-first merge. Meeting correction now requires `reconcile_meeting_attendance`; Google preview/commit additionally requires exact `import_meetings` at route, data, render, and direct Server Action boundaries; server-derived meeting row decisions/recovery require reconciliation; scheduling/cohort views receive no roster options; the meeting picker uses a paginated active, organization-scoped projection containing only option identifiers and labels. Exact local root integration passed typecheck, exact lint, 8 focused private meeting/import test files carrying 223 tests and 1,372 expectations, and the canonical 207-root/206-plugin test-file gate measured after `development` was merged in; the earlier 72-test/739-expectation and 205-root figures described the pre-merge subset and tree. The private repository has no GitHub workflow or branch protection, so no private hosted CI is claimed; the root gitlink, root CI, compiled role/browser journeys, and hosted Development acceptance remain pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| AUD-038         | P1       | `plugin_data.csf_correct_meeting_attendance` performs no database-side permission recheck. The `SECURITY DEFINER` function validates the operation, status, reason, and a non-null actor, locks the meeting and attendance rows, and writes attendance plus immutable audit history, but never verifies that `p_actor_user_id` holds `reconcile_meeting_attendance`, an active CSF staff position, or active membership in `p_organization_id`. Authorization for manual attendance correction exists only in the TypeScript Server Action.                                                                                                             | CSF meetings               | Defense-in-depth only, and deliberately not rated higher: `20260716224500_dvhs_csf_manual_attendance_corrections.sql` revokes the function from `PUBLIC`, `anon`, and `authenticated` and grants `EXECUTE` solely to `service_role`, and no later migration redefines or re-grants it, so no browser-reachable escalation exists and no exploitation is claimed or observed. Bring it to the AUD-028 standard: recheck actor authorization after the meeting row lock inside the same transaction, keep the stable service-only signature, and add adversarial pgTAP proving a revoked or unauthorized actor fails with zero attendance and zero audit mutation. Established by local source review of the ordered migration ledger on this integration branch; no migration, hosted database, or Production evidence exists. Root PR #168 is a gitlink/docs integration and does not fix this.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| AUD-039         | P2       | The SQL import compatibility map disagrees with the new exact TypeScript meeting boundary. `plugin_data.csf_import_compatibility_permissions('meeting_attendance')` still returns `{manage_sheet_sync, resolve_imports}`, so the database actor assertion still admits a legacy custom role holding either broad grant for meeting-attendance imports, while the meeting sync and commit Server Actions now require exact `import_meetings`. The `scoped-permissions.ts` comment states that the SQL and TypeScript lists are held equal by a parity test; that parity now covers only the compatibility arrays, not the effective per-source boundary. | CSF imports                | The reachable route is the stricter side, so the divergence fails closed and is a consistency defect rather than an escalation. Decide one direction: either drop the meeting-attendance compatibility grants in SQL through a forward migration with the reviewed `REVOKE`/`GRANT` restatement and focused pgTAP, or re-admit them in TypeScript; then restore a parity test that compares the effective per-source boundary instead of only the compatibility arrays. Established by local source review of `20260730001004_dvhs_csf_import_commit_recovery.sql` against private gitlink `4f20fa5`; no migration is included here and no hosted evidence exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| AUD-040         | P2       | The reconcile-capable meetings RSC payload carries the entire active roster and personal emails. `getCsfMeetingAttendanceProfileOptions` pages through every active `csf_profiles` row for the organization with no upper bound and builds each option label from the display name plus `school_email` plus `personal_email`, so an actor holding correction authority receives the chapter's whole active roster, including personal addresses, serialized into the page payload.                                                                                                                                                                      | CSF meetings               | Not an authorization or tenant defect: the projection is organization-scoped, restricted to `record_status = 'active'`, and reaches only actors who already hold `reconcile_meeting_attendance`, which is why this is rated P2 as data minimization rather than exposure. Replace the exhaustive prefetch with a bounded server-side search or typeahead returning identifiers and a disambiguating label without personal email, or record an explicit officer justification for the personal address; then assert both the absence of personal email and a bounded option count in the payload tests. Established by local source review and the 2 focused option tests at private gitlink `4f20fa5`; no hosted or browser evidence exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| AUD-041         | P1       | `content_reports` was client-written: `authenticated` held INSERT/UPDATE/DELETE with owner policies, so a reporter could file evidence with chosen status and priority, rewrite or delete it afterwards, name a target that does not exist, and forge the dashboard's metadata markers. The route carried no durable rate limit at all — neither per user nor per address — and a retried submission duplicated evidence.                                                                                                                                                                                                                               | Platform moderation        | `20260812203000_make_content_reports_server_written.sql` removes every browser write grant, column grant, and write policy, keeps owner-scoped SELECT, updates the reviewed relation catalog literally, and adds a service-role-only SECURITY DEFINER transaction that owns moderation state, confirms the target exists, decides the user and address buckets as one all-or-nothing charge, and replays a duplicate only inside a server-derived 15-minute window. A separate, higher attempt ceiling is charged before the target lookup so refused work is bounded too, and the reporter pseudonym is a random UUID in a server-only mapping rather than a recomputable hash. The route and service add fresh authentication, bounded strict input, same-origin relative URLs that degrade to absent on preview aliases, reporter-visible target resolution, and redacted logs; deletion and enforcement bans detach the reporter instead of erasing evidence. 84 + 8 pgTAP assertions and 82 route/service/domain/retention tests pass locally; hosted Development remains pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| AUD-042         | P1       | Legacy `plugin_data` default ACLs re-granted `authenticated` on every future table, sequence, and routine created in the private schema, so the next private-plugin migration would silently reopen it.                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Plugin/database security   | `20260812203500_close_plugin_data_browser_default_acl.sql` revokes schema, existing-object, and default privileges from `PUBLIC`, `anon`, and `authenticated` for every role that owns objects here, preserves `service_role` usage, and fails closed on residue. PostgreSQL's built-in global default still grants `PUBLIC` EXECUTE on new functions and cannot be revoked per schema, so schema USAGE denial is the enforced gate and both the migration probe and 17 pgTAP assertions prove unreachability by calling as the browser roles. Hosted Development remains pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| AUD-043         | P1       | Three fixed-empty-path private SECURITY DEFINER helpers retained PostgreSQL's default `PUBLIC` execute capability. `private.is_plugin_enabled(uuid,text)` has no runtime caller; `private.is_dv_student(uuid)` and `private.can_access_dv_household(uuid)` are called by 13 and 7 authenticated DV RLS policies respectively. `private` is not exposed through PostgREST, so no browser-callable exploit is claimed, but the per-object ACLs exceeded the reviewed private-helper boundary.                                                                                                                                                             | Platform database security | `20260813085442_harden_private_is_plugin_enabled_acl.sql` keeps the dormant helper owner-only. `20260813091801_harden_dv_private_policy_helper_acls.sql` preserves the two stable SQL definitions and their empty `search_path`, revokes `PUBLIC`, `anon`, `authenticated`, and `service_role`, then restores only the policy-proven `authenticated` role plus owner `postgres`. The source contracts pin the exact signatures, security mode, all 20 authenticated policy callers, absence of another runtime caller, and ACL statements; 8 + 20 pgTAP assertions pin the direct and effective role posture. These functions are private and are therefore not added to the public callable catalog. Focused source coverage passes; exact replay and hosted Development remain pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### Integrated project/auth findings

| ID        | Priority | Finding                                                                                                                                                                                                                                                                                                                    | Owner                      | Evidence / exit gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLEAN-021 | P1       | Project cancellation uses permission-rechecked, conditional at-most-once dispatch over a frozen recipient/channel ledger; only proved pre-send failures retry, ambiguous outcomes never resend, legacy work is parked for review, and immutable snapshots survive parent deletion with separately guarded live references. | Platform project lifecycle | Preserve the snapshot-ledger audit exception, 90-day PII redaction, bounded organization-fair claims/reapers, and the documented manual/provider recovery boundaries; run the deferred database and hosted gates on the exact combined tree.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| AUD-022   | P1       | Direct project writes, recurrence pagination/catch-up, cloning, and feedback dispatch previously bypassed or weakened schedule and delivery invariants.                                                                                                                                                                    | Platform project lifecycle | Retain strict shared schedule validation, authenticated-before-parse actions, clone allowlisting, stable keyset scans, bounded history fast-forward, phased feedback dispatch, exact signup-slot dates, and the forward migrations `20260812100200`/`20260812100300`; exact combined replay remains pending.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| AUD-023   | P1       | Project cancellation, signup unrejection, recurrence cancellation, and parent deletion could interleave across branch-local assumptions.                                                                                                                                                                                   | Platform project lifecycle | Retain the reconciled lock ordering, atomic capacity-aware unrejection, cancellation snapshot exception, source contracts, and cross-branch concurrency coverage from the ordered project series.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| AUD-024   | P1       | Browser roles held whole-table organization privileges that bypass RLS.                                                                                                                                                                                                                                                    | Platform organizations     | `20260812100000_organization_username_reserved_slugs` revokes unsafe `TRUNCATE`, `REFERENCES`, and `TRIGGER` privileges while preserving reviewed RLS-gated DML; retain adversarial ACL coverage and require exact combined replay.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| AUD-025   | P2       | Organization username format could diverge across clients and direct writes.                                                                                                                                                                                                                                               | Platform organizations     | Retain the shared ASCII schema, Server Action coverage, `NOT VALID` database constraint, fixture inventory, and historical/hosted validation gates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| AUD-031   | P1       | Confirmed: inactive organization rows still satisfied shared role helpers, so a deactivated admin or staff actor could retain tenant authority and attempt self-reactivation or cross-tenant writes through helper-backed RLS.                                                                                             | Platform organizations     | **Fixed locally:** `20260813013000_reconcile_project_lifecycle_boundaries.sql` hardens shared helpers, and `20260813013100_lock_project_lifecycle_transactions.sql` forward-replaces cancellation, unrejection, and hours-publication authorization so only exact active memberships survive their locked recheck. pgTAP covers null, inactive, active, creator, and cross-tenant controls. Hosted Development remains unapplied and unverified.                                                                                                                                                                                                                                                                                             |
| AUD-032   | P1       | Confirmed: authenticated project updates could enter `cancelled` without the atomic cancellation ledger or revive an already cancelled project, while ordinary non-cancellation status changes remained browser-direct.                                                                                                    | Platform project lifecycle | **Fixed locally:** `20260813013100_lock_project_lifecycle_transactions.sql` denies every direct authenticated status change and adds a locked, actor-derived transition RPC for the reviewed forward graph; cancellation remains on its frozen-audience transaction. Exact receipt, denial, rollback, and concurrency tests cover the app and database boundaries. Hosted Development remains unapplied and unverified.                                                                                                                                                                                                                                                                                                                      |
| AUD-033   | P1       | Confirmed: recurrence generation did not serialize on the parent while series ending was a public SECURITY DEFINER transaction, allowing a stale child insertion and leaving a privileged public-function advisor exception.                                                                                               | Platform project lifecycle | **Fixed locally:** the preserved one-argument invoker wrapper and new atomic edit overload lock the parent and eligible children before deciding cancellation and cleanup IDs, delegate actual child cancellation to the canonical ledger, persist an immutable generation-and-edit-bound private replay marker even for zero-child series, return exact retries before parent mutation, reject mismatched reuse, and roll back child work when the ordinary edit fails. Two-session tests cover status/cancellation, child-generation/series-end, and membership-revocation orderings. The ledger tail reapplies the combined approval/attendance/rejection guard required after #152. Hosted Development remains unapplied and unverified. |
| AUD-034   | P1       | Confirmed: every healthy paginated cancellation-worker claim consumed the same five-attempt budget as an abandoned lease, so a large audience could fail without a worker fault and amplify retries across runs.                                                                                                           | Platform project lifecycle | **Fixed locally:** finalization refunds only an owned, unexpired provisional claim with `GREATEST(..., 0)`; abandoned leases retain attempts, and the worker keeps one global delivery budget with per-job quanta. The 20-test worker suite, fresh replay, focused pgTAP, and the full test suite pass. Hosted Development remains unapplied and unverified.                                                                                                                                                                                                                                                                                                                                                                                 |
| AUD-030   | P1       | Signup rejection used a browser-direct status update followed by a separate client notification, so notification failure could leave a committed rejection and caller-supplied compatibility identifiers could redirect a privileged notification.                                                                         | Platform project lifecycle | Fixed locally by `20260812161500_atomic_project_signup_rejection.sql`: one authenticated UUID-only wrapper reaches a fixed-path private transaction that locks project then signup, binds tenant coordinates, requires explicitly active management while preserving super-admin authority, returns replayed for an existing rejection, and atomically honors anonymous/preference notification behavior. The same forward migration closes NULL-status unrejection and status-blind self-reactivation. Fresh owned isolated replay passed 274 migrations, 124 pgTAP files, and 5,230 assertions; hosted Development remains at 273 and acceptance is pending.                                                                               |

The combined Development tree contains implementation candidates for CLEAN-006
through CLEAN-014. CLEAN-006 no longer claims the earlier replay or visible
acceptance: hostile review invalidated that evidence. Its amended migration now
also preserves settled frozen import evidence and blocks every unsettled target,
but the exact migration plus new pgTAP/browser coverage still require a fresh
isolated replay and compiled refusal + success journeys. CLEAN-013 retains its prior named local evidence but
remains active until hosted Development acceptance. The other rows still require
their named exit gates. Focused
tests or a locally edited contract alone do not close a finding. CLEAN-015's
migration, route, pgTAP, exact central
replay, hold-state contracts, and repository-owned GitHub scheduler are now
implemented. The visible Development composer schedule/readback/archive
lifecycle is accepted. It remains open only through the default-branch/hosted
invocation and visible schedule → Feed publication gates; officers use manual
publication until that evidence exists in the target environment.

CLEAN-007 now has a private-first implementation merged through private PR #33
at `2ce0a3d`. The root integration candidate adds a server-only, tenant-scoped,
bounded batch of the canonical database decision preflight; queue, detail, and
modal consume permission-shaped projections from that same source. Local
evidence includes a clean empty replay and the full pgTAP suite,
36 focused private tests, and a compiled Playwright queue → detail → modal
journey. The finding remains active until the exact root gitlink is merged,
root CI is green, and the hosted Development journey is accepted.

### Knowingly unchanged automated findings

`scrollable-region-focusable` on the Point submissions `role="tablist"` is not
being "fixed". The list is horizontally scrollable and axe cannot see that its
tab triggers use the roving-tabindex pattern, so arrow keys already move focus
and scroll the container. Adding `tabIndex={0}` to the tablist would create a
purposeless focus stop and fight the pattern. Re-evaluate only if manual
keyboard testing shows the region is genuinely unreachable.

See [the 2026-08-10 audit register](audit-register-20260810.md) for the AUD finding evidence and release boundaries. Production P0s remain outside this Development-only rollout until separately authorized.

### Historical identity-hardening candidate evidence — superseded

CLEAN-006 and CLEAN-013 retain implementation candidates on this branch. The
profile-merge work catalogs current-schema references, preserves settled frozen
import evidence, blocks unsettled targets, applies an organization-first identity
lock hierarchy, and covers same-organization and cross-organization races. The
account-connection work recomputes confirmed-email, exact-name, and single-active-
cohort corroboration under lock and fails closed. The pre-integration identity
line passed its documented local replay, focused pgTAP/source contracts, static
quality gates, dependency audit, and strict submodule validation on 2026-08-12.
That evidence does not establish this release-integration tree or the upstream
merged private gitlink. These findings remain active pending the final combined
gates, compiled browser acceptance, upstream-feedback acceptance testing, and
hosted Development verification.

### Production release review findings (2026-08-18)

| ID      | Priority | Finding                                                                                                                                                                                                                                                                                                                   | Owner                        | Evidence / exit gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUD-035 | P1       | A Google authorization code could be presented to the provider after the durable attempt ledger failed to record the exchange marker.                                                                                                                                                                                     | Platform Google OAuth        | Fixed in the release candidate: the callback checks the marker result and returns `connection_in_progress` before any provider request when the current claim cannot persist it. The focused round-three contract and existing OAuth state suite pass; exact CI and hosted release gates remain required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| AUD-036 | P1       | A rolled-back signup could leave newly uploaded private waiver evidence without a durable cleanup record when queue persistence failed.                                                                                                                                                                                   | Platform waiver lifecycle    | Fixed in the release candidate: the durable outbox remains primary and a failed enqueue immediately removes the unreferenced objects from the private bucket, with redacted failure telemetry. The focused round-three contract and waiver cleanup suite pass; exact CI and hosted release gates remain required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| AUD-037 | P1       | One persistent paper-scan Storage deletion failure could prevent the same cleanup invocation from transactionally purging and enqueueing newly expired batches.                                                                                                                                                           | Platform paper scans         | Fixed in the release candidate: initial drain errors are retained for the failed worker result, but the transactional purge and final drain still run first. The focused round-three contract passes; exact CI and hosted release gates remain required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| AUD-038 | P1       | A delayed moderation result could overwrite the pending verdict for a newer edit of the same feedback comment.                                                                                                                                                                                                            | Platform moderation          | Fixed in the release candidate: settlement is conditional on both the exact moderated text and the row remaining pending; notification is emitted only when that conditional write succeeds. Exact round-four tests, CI, and hosted release gates remain required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| AUD-039 | P2       | Supplemental certificate issuance failures after an already-published paper attendance commit were discarded from the operator response.                                                                                                                                                                                  | Platform hours               | Round-four remediation returns the bounded failure details and exposes an explicit idempotent retry path after attendance succeeds. Exact tests, CI, and hosted release gates remain required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| AUD-040 | P2       | A paper-scan review-row edit could race the locked batch commit and mutate the row after the batch became committed.                                                                                                                                                                                                      | Platform paper scans         | Round-four remediation moves the edit behind a service-only RPC that locks the parent batch and conditionally updates only while it remains in review. Exact replay, pgTAP, CI, and hosted release gates remain required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| AUD-041 | P2       | The scan endpoint could return extraction success after losing ownership of the batch's final state transition.                                                                                                                                                                                                           | Platform paper scans         | Fixed in the release candidate: both unreadable and successful final transitions require an error-free, matched claim-owned update before clearing local ownership or returning. Exact round-four tests, CI, and hosted release gates remain required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| AUD-042 | P2       | A retry could continue after failing to clear stale paper-scan staging rows, allowing an empty new extraction to expose rows from the previous attempt.                                                                                                                                                                   | Platform paper scans         | Round-five remediation treats any staging-row deletion error as a failed claimed extraction before reading new images. Focused source coverage pins the checked deletion result; exact CI and hosted release gates remain required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| AUD-043 | P1       | Organizer feedback summaries exposed pending comment text when a blocked moderation verdict could not be durably settled.                                                                                                                                                                                                 | Platform moderation          | Round-five remediation fails closed for pending, blocked, and unknown moderation states; only settled `allowed` or `flagged` text reaches organizers. Focused source coverage and exact CI remain required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| AUD-044 | P2       | The application-level feedback-summary gate rejected platform admins even though the database policy and product contract explicitly authorize them.                                                                                                                                                                      | Platform feedback            | Round-five remediation admits only the existing app-metadata-derived super-admin predicate before the manager predicate; user metadata remains untrusted and RLS remains the second gate. Focused source coverage and exact CI remain required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| AUD-045 | P2       | The durable paper-attendance notification outbox had a worker route but no hosted recurring caller, so enabled deliveries could remain queued indefinitely.                                                                                                                                                               | Platform notifications       | Round-five remediation adds a bounded, retrying GitHub Actions scheduler every ten minutes, using the existing Production environment, dedicated worker token with shared-token fallback, Vercel bypass, concurrency, and heartbeat conventions. Source contract, exact CI, and hosted invocation evidence remain required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| AUD-046 | P2       | The server accepted trusted role-only platform-admin metadata while the canonical database RLS helper recognized only the boolean flag, yielding successful but empty privileged reads.                                                                                                                                   | Platform authorization       | Round-six remediation forward-replaces `public.is_super_admin()` so the boolean and locale-independent, ECMAScript-whitespace-normalized role-only shapes in trusted `app_metadata` match the server helper, while user metadata, top-level claims, Unicode confusables, and malformed values fail closed. Explicit ACLs and nine adversarial pgTAP assertions pin the boundary; exact replay, CI, and hosted gates remain required.                                                                                                                                                                                                                                                                                                                                                                                      |
| AUD-047 | P1       | The partner-club simplification migration replaced twelve `plugin_data` functions without explicitly restating their reviewed ownership and execution ACLs.                                                                                                                                                               | CSF database boundary        | Round-seven remediation uses a forward-only migration to restore `postgres` ownership, deny `PUBLIC`/`anon`/`authenticated`, and preserve `service_role` execution only for the reviewed recovery and recipient-snapshot trigger functions. Four aggregate pgTAP assertions pin all twelve exact signatures without changing historical migrations or unrelated overloads.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| AUD-048 | P2       | Legacy certificate resend normalized a multi-day session ID before querying certificates, so certificates published before the durable ledger under the raw five-part session ID could not be found.                                                                                                                      | Certificate delivery         | Round-seven remediation scopes the legacy lookup to the project and both the raw session ID and normalized publish key, while retaining the durable-ledger-first path and manager authorization check. The source boundary contract pins the two-key fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| AUD-049 | P2       | The feedback worker rotated across every historical completed project, so at sufficient volume one full rotation could exceed the 30-day eligibility guard and starve newly eligible projects.                                                                                                                            | Platform feedback            | Round-eight remediation uses an indexed, service-only, security-invoker read model containing only projects with an attended identity not already represented in the durable queue, then applies a conservatively padded 30-day calendar window before rotating. TypeScript retains the exact timezone-aware 24-hour floor, publication hold, 96-hour backstop, and 30-day guard. Ten pgTAP assertions and focused worker tests pin the boundary.                                                                                                                                                                                                                                                                                                                                                                         |
| AUD-050 | P1       | Four private plugin-release helpers introduced or replaced after the prior ACL restoration denied browser roles but omitted the required explicit owner execution grant.                                                                                                                                                  | Plugin control plane         | Fixed by the forward-only `20260821233000_complete_plugin_release_helper_acls.sql` migration. It restores `postgres` ownership, denies `PUBLIC`/`anon`/`authenticated`/`service_role`, and explicitly grants `postgres` execution for all four exact signatures. The aggregate private-helper pgTAP test now includes each signature; exact replay and hosted release gates remain required.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| AUD-051 | P1       | The plugin application workflow targeted a Vercel custom environment named `development`, but the child project supports no custom environments. The signed 1.2.2 Development bundle was also built for that unavailable target, so Vercel rejected it when the deploy lane moved to Preview.                             | Plugin deployment            | Fixed in signed 1.2.3 by mapping the logical Development release artifact to Vercel Preview during both `vercel pull` and `vercel build`, while retaining a Production-targeted Production artifact. The root deploy workflow selects Preview without `--target=development` and accepts the CLI's `preview` or omitted target response. Hosted 1.2.3 rerun remains required.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| AUD-052 | P2       | Application routing rejected historical mixed-case organization usernames even though the organization table and existing settings flow preserve them.                                                                                                                                                                    | Plugin application routing   | Fixed by forward migration `20260823040000_route_historical_mixed_case_organization_usernames.sql`. Public caller-scoped RPCs now resolve the exact historical username or UUID and delegate to the prior reviewed access logic in the private schema. Final local replay passed, and the focused route pgTAP file passes 61 assertions. Hosted acceptance remains required.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| AUD-053 | P2       | The SDK accepted UI-only configuration formats such as `textarea`, but the admin runtime validator could throw while compiling the same schema.                                                                                                                                                                           | Plugin configuration         | Fixed by disabling format assertion in both Ajv validators while retaining schema constraints. The shared manifest/runtime regression passes within the 35-test SDK file, and full typecheck passes. Exact PR and hosted acceptance remain required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| AUD-054 | P1       | An embedded plugin release could advance unrelated embedded plugin code in the shared private gitlink without updating the unrelated plugin's published source identity.                                                                                                                                                  | Plugin release integrity     | Fixed by checking the latest published embedded tree for every plugin on every release. Only the plugin named by an embedded release may change; application releases may change no embedded tree. The focused integration suite passes 17 tests, including the unrelated-plugin refusal. Exact PR and hosted release evidence remain required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| AUD-055 | P2       | An independent child app could load an explicitly configured TypeScript type root or type package from outside its application root without exposing that dependency through parsed source inputs.                                                                                                                        | Plugin application boundary  | Fixed by resolving explicit type roots and type packages, following existing paths to their real locations, rejecting external type roots and undeclared external packages, and permitting only declared `@types` packages from `node_modules`. The focused boundary suite passes 23 tests, including external root and package cases. Exact PR evidence remains required.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| AUD-056 | P1       | The anonymous public organization member view joined a security-invoker profile view, so reading otherwise permitted public membership rows required direct `profiles` access and logged `42501 permission denied for table profiles`.                                                                                    | Platform organizations       | Fixed by forward migration `20260823200804_remove_profiles_dependency_from_public_org_members.sql`. The view now returns only the membership fields used by the public route, while the server-only profile data-access layer resolves the permitted public profile projection. The focused anonymous pgTAP regression and the complete 6,235-assertion database suite pass locally. Hosted Development applied the migration and a transaction-scoped `anon` query returned the permitted public rows without error. Production runtime confirmation remains separate.                                                                                                                                                                                                                                                   |
| AUD-057 | P1       | Supabase GitHub configuration sync replayed bucket updates after migrations had already established the same Storage catalog. The Management API returned HTTP 413 after migration success, which failed the GitHub check without changing database health.                                                               | Supabase release integration | Fixed by keeping application bucket metadata solely in the append-only migration ledger and removing duplicate `[storage.buckets.*]` declarations from `config.toml`. A source contract prevents dual ownership. A fresh 360-migration reset recreated the reviewed eleven-bucket catalog, and the Storage posture pgTAP contract passed within the complete database suite. The hosted Supabase Preview check passed for `038ac733`, and the Development bucket catalog retained the reviewed eleven-bucket shape.                                                                                                                                                                                                                                                                                                       |
| AUD-058 | P1       | Drive's opaque native-Sheets anchors were ignored, so quote matching could duplicate comments across tabs or attach an out-of-range comment to unrelated selected evidence.                                                                                                                                               | CSF Google Sheets import     | Fixed by reading Google's native Sheets comment threads with range-filtered `commentAnchors` and attaching only a provider-owned, single-cell coordinate inside exactly one bounded snapshot. The legacy Drive endpoint is now manual-placement evidence only. Focused import, exact CI, and hosted Development acceptance remain required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| AUD-059 | P2       | Partner-policy review idempotency normalized omitted notes and an explicit empty-string clear to the same request fingerprint.                                                                                                                                                                                            | CSF database boundary        | Fixed by a forward-only wrapper receipt that fingerprints `preserve`, `clear`, and `set` intent separately before delegating to the existing atomic review transaction. pgTAP rejects a reused request UUID whose note intent changes. Exact replay and hosted Development acceptance remain required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| AUD-060 | P2       | Application import profile creation delegated its request UUID to a generic profile fingerprint that did not include the import row or officer reason.                                                                                                                                                                    | CSF database boundary        | Fixed by a forward-only, row-scoped wrapper receipt that binds the request UUID to the exact import row, normalized reviewed reason, actor, and stored result before a replay can return. A unique partial receipt index and pgTAP contract pin the boundary. Exact replay and hosted Development acceptance remain required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| AUD-061 | P2       | An unqualified bounded range could ask the comment-anchor endpoint about the workbook's default tab instead of the request's fallback tab.                                                                                                                                                                                | CSF Google Sheets import     | Fixed by qualifying every unqualified anchor range with the same escaped fallback tab used by snapshot acquisition. The focused multi-tab regression pins both provider request ranges. Exact CI and hosted Development acceptance remain required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| AUD-062 | P1       | Native Sheets threads that had a valid multi-cell anchor or could not be assigned to exactly one bounded snapshot were reduced to a count, losing their content, replies, coordinates, and provenance effect.                                                                                                             | CSF Google Sheets import     | Fixed by retaining normalized workbook-level evidence for every unmatched anchored or legacy thread, returning it with each fenced snapshot and acquisition, and hashing the evidence into each snapshot digest. Focused tests pin multi-cell content, replies, coordinates, and legacy evidence. Exact CI and hosted Development acceptance remain required.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| AUD-063 | P1       | Replaced CSF normalization helpers, source-settings helpers, and the created-profile resolution trigger denied public roles but lacked the required explicit execution grant for their reviewed owner role.                                                                                                               | CSF database boundary        | Fixed by forward migration `20260826074500_complete_csf_internal_helper_acls.sql`, which denies `PUBLIC`/`anon`/`authenticated`/`service_role` and explicitly grants `postgres` execution on all six exact internal signatures. Aggregate pgTAP coverage pins the complete helper set. Exact replay and hosted Development acceptance remain required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| AUD-064 | P2       | A semester containing meeting attendance but no application, points, submissions, or imported activities disappeared from the member profile. Activity names and meeting attendance also rendered in separate cards, obscuring their shared semester context.                                                             | CSF member profiles          | Fixed by private `a83ffe3` and root `b2108f6f`: attendance now makes a term visible, and one semester participation ledger renders exact imported activity names, awarded points, meeting names, and attendance. Typecheck, zero-warning lint, 224 private-plugin test files, Supabase Preview, Vercel, and both code-analysis checks pass. Hosted Development browser acceptance now confirms the Riddhiman account can open DVHS CSF, its classes, member directory, member profile, imports, class settings, and the linked-spreadsheet picker. Real-sheet linking remains a separate staff-approved data action.                                                                                                                                                                                                      |
| AUD-065 | P1       | The TypeScript class-history allowlist emitted the stable linked-sheet `sourceStudentKey`, but the database canonical-record schema rejected that same field. Production could analyze a tab, then failed before recording any preview row.                                                                               | CSF Google Sheets import     | Fixed by forward migration `20260828070641_allow_csf_class_history_source_student_key.sql`. The closed class-history schema now accepts the source key while application and roster schemas still reject it, and the helper keeps its owner-only ACL. A private structural parity test, 8 pgTAP assertions, a complete local migration replay, and database validation pass. Hosted Development, schema promotion, and an authorized Production resync remain required.                                                                                                                                                                                                                                                                                                                                                   |
| AUD-066 | P1       | Class-history tabs compute their stable `FirstLast` or `LastFirst` roster key with a sheet formula. Preview retained the effective value but still blocked every row merely because that approved source-key column contained a formula.                                                                                  | CSF Google Sheets import     | Fixed with a class-history-only effective-value rule. The formula coordinate is nonblocking only when the retained source key exactly equals the normalized first-plus-last or last-plus-first name; mismatched keys and formulas in every other retained field remain blocking. Focused parser and formula tests pass, including 105 import-service assertions, plus root typecheck and lint. Hosted Development and an authorized Production resync remain required.                                                                                                                                                                                                                                                                                                                                                    |
| AUD-067 | P1       | A `FirstLast` or `LastFirst` formula could carry leading or trailing whitespace from either name cell into the middle of its effective roster key. The parser trimmed only the whole key, so those rows remained blocked and the key could vary between semester tabs.                                                    | CSF Google Sheets import     | Fixed by canonicalizing class source keys without whitespace while preserving punctuation, then using that same canonical form for formula validation, duplicate identity, preview matching, and prior source-backed evidence. The linked 2027 S25 tab had 218 roster-key formulas with one formula shape and exactly 8 whitespace-only mismatches. Focused coverage passes with 90 tests and 233 assertions; formatting, lint, typecheck, and the full 226-file private suite pass. Hosted Development and an authorized Production resync remain required.                                                                                                                                                                                                                                                              |
| AUD-068 | P1       | Class sheets linked before the one-point activity-slot mode was added retained the legacy numeric-only mapping. Later syncs therefore promoted ordinary activity labels to blocking review errors instead of importing each populated slot with its source label and one point.                                           | CSF Google Sheets import     | Fixed by repairing legacy linked-class mappings through the authorized source-registration action before preview. The versioned mapping records `one_per_populated_slot` and keeps numeric-only behavior for non-class sources. Production diagnosis traced 64 blocked S25 rows and 35 blocked S28 rows in the 2028 workbook to this stale mode. Focused coverage passes with 74 tests and 261 assertions; the platform-host gate passes 3,192 tests and 8,669 assertions. Hosted Development and an authorized Production resync remain required.                                                                                                                                                                                                                                                                        |
| AUD-069 | P1       | Class templates prefilled a derived roster-key formula below the populated roster. Errors in otherwise empty capacity rows were treated as nameless students, creating false review work.                                                                                                                                 | CSF Google Sheets import     | Fixed by classifying a formula-error roster key as blank capacity only when both names and every other cell are empty. A valid key without names, or any activity or contact value, still requires officer review. Live Production showed 35 false S28 review rows in the 2028 workbook. Focused coverage passes with 61 tests and 185 assertions; private lint and typecheck pass, and the complete 226-file host/plugin gate passes. Hosted Development and an authorized Production retry remain required.                                                                                                                                                                                                                                                                                                             |
| AUD-070 | P1       | Accepted class formulas may concatenate first-plus-last or last-plus-first. The parser retained that orientation while duplicate consolidation required exact source keys, leaving semester-specific profiles split.                                                                                                      | CSF member identity          | Fixed by converting either approved formula orientation to one canonical key, reading immutable origin and committed lineage, and routing exact-key groups through the locked database merge preview. Equivalent same-semester memberships may consolidate only when their outcomes and overrides agree; email, account, class, relationship, and unrelated conflicts remain blocked. The merge stores the original rows and resolved membership in private audit evidence. Private lint, typecheck, the complete host/plugin gate, migration replay, and focused identity and consolidation tests pass. Production release `063a0206` merged the remaining source-verified records, and the post-merge audit reports zero exact linked-sheet duplicate groups across classes 2027–2030. Closed with Production evidence. |
| AUD-071 | P1       | The plugin runtime-contract audit imported the private registry as its entry point. Private UI dependencies can reach the canonical root registry during module initialization, so Bun observed `privatePlugins` before initialization and stopped the complete isolated database gate after all pgTAP assertions passed. | Plugin release verification  | Fixed by loading the canonical root registry once and deriving its private definitions from the same sorted registry used by the application. The direct runtime-contract audit and the complete isolated gate must pass on the exact release tree before closure.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| AUD-072 | P1       | Deterministic application analysis produced zero-based column positions, but saved mappings use one-based spreadsheet keys. Every analyzed field shifted one column left during preview, so valid grade values could not resolve a class and names, emails, totals, and evidence were read from the wrong columns.        | CSF application import       | Fixed by converting analyzed array indexes to one-based stable column keys at the analysis boundary. A synthetic end-to-end regression passes an analyzed Forms layout directly into the parser and confirms exact names, contact slots, grade, transcript, and receipt fields. Focused analysis, parser, and normalized-adapter coverage passes with 79 tests and 238 assertions. Production preview on the authorized 517-row source resolves the grade-to-class mapping, exposes the verified commit control, reports zero parser-ready rows and 517 identity-review rows, and shows no runtime error. Closed with Production evidence on release `063a0206`.                                                                                                                                                          |
| AUD-073 | P1       | Application preview requires staff to resolve same-name member candidates one row at a time. The authorized Spring 2026 source contains 284 rows with exactly one same-name candidate in the target class, but name plus class is not stable identity evidence.                                                           | CSF application import       | A proposed bulk name-only confirmation path was rejected before Production and removed. Production inspection found no contact emails in 6,166 class-import rows, no exact profile-email match for any of the 517 application rows, and only one active profile with a stored email. The existing individual resolution flow remains because it records the selected candidate and the required officer explanation. Automatic application matching stays limited to an exact stable identifier or a unique verified email. Focused duplicate coverage, private lint, and typecheck pass. This is a documented product constraint, not a safe automation defect to close by guessing.                                                                                                                                     |

| AUD-074 | P1 | Linked-sheet duplicate cleanup rebuilt an immutable roster key with the current profile name. A later name correction could therefore split two rows carrying the same official `FirstLast` or `LastFirst` formula before the database conflict review saw them. | CSF member identity | Fixed by retaining both the raw official workbook key and the canonical orientation proved by the immutable row names, using current profile names only for older rows that lack normalized identity. Overlapping aliases schedule each source-target pair once, and the database preview remains authoritative for email, account, class, semester, and relationship conflicts. Thirty-one focused tests pass with 118 assertions; private typecheck, lint, and the complete plugin-quality gate pass. Production cleanup merged two source-verified Class of 2027 records. A post-merge audit reports zero exact linked-sheet duplicate groups in classes 2027, 2028, 2029, and 2030. Closed on release `063a0206`. |
| AUD-075 | P1 | Older imported profiles that predated the roster-key field kept their immutable workbook tab and row but never received the key from a later committed preview of that same coordinate. Exact-key cleanup therefore missed those term-split records. Production Class of 2028 still had 168 repeated-name groups across 475 active records. | CSF member identity | Fixed by adding the same exact-coordinate and normalized-name proof to the server planner and locked database merge, consolidating only identical term and meeting outcomes, and retaining private snapshots linked to the approved merge review. Production release `9689e80f` and protected schema run `33226526425` passed migration validation, full replay, pgTAP, schema integrity, security advisors, and exact project verification. The bounded Production cleanup merged all 307 remaining Class of 2028 records and retained audit evidence for 307 term and 77 meeting consolidations. The post-merge audit reports zero shared linked-sheet source keys, zero repeated normalized-name groups, zero records attached to merged profiles, zero blank activity or meeting labels, zero invalid points, and zero activity or meeting rows without a matching semester membership across classes 2027–2030. Live profile inspection shows the original activity names, awarded points, and meeting labels together across semesters. Closed with Production evidence. |
| AUD-076 | P1 | Class-history sync stored each member's award and profile event with a copied title but no `csf_opportunities` relationship. The officer page grouped that text at read time, so 1,451 Class of 2028 awards looked like independent activities and the database could not traverse one semester activity to its participating profiles. Imported attendance likewise retained meeting labels without canonical meeting and session links. | CSF activity and meeting model | Fixed by forward migration `20260829020011_csf_canonical_imported_activity_links.sql`. It creates one archived canonical opportunity per organization, semester, and exact normalized source title, links awards and profile events to it, and links imported attendance to the canonical meeting/session model. Future fenced Google Sheet commits reuse these records automatically. The public page now accepts one general join code and resolves the class before account and student-record matching. Signed plugin release `dvhs-csf/v1.2.23`, root release `639378e2`, Production schema run `33230485210`, and signed application run `33230736229` passed. The Production audit found 1,369 unique canonical activity identities with zero duplicate identities, 4,038 linked awards, 4,038 linked profile events, and 1,208 linked attendance records with zero incomplete relationships. Classes of 2027–2029 hold the imported history; Class of 2030 currently has no active imported profiles or history. Closed with Production evidence. |
| AUD-077 | P1 | A linked member without accepted current-semester membership still received the approved-member points rail, agenda, workflow links, setup tour, and their backing reads. Post browser acceptance also stopped after durable queue creation and did not prove worker dispatch or mailbox receipt. | CSF member onboarding and communications | Fixed on private Development at `e459616`: pending, unavailable, refused, completed, and revoked states now resolve through one tested presentation model. Pending linked members receive the class Feed and one short review notice, while approved-member tools and requirement reads stay absent. The post result copy now reports publication and email outcomes without a repeated explainer. Eight isolated browser scenarios pass, including worker dispatch, sent delivery rows, exact local Mailpit receipt counts, and synthetic cleanup. A separate Development Resend probe to `delivered@resend.dev` reached `delivered`; no student recipient was contacted. Focused tests, typecheck, zero-warning lint, all 261 plugin test files, the optimized build, strict gitlink checks, CodeQL, and the Vercel Development deployment pass. Authenticated hosted browser acceptance remains separate. |
| AUD-078 | P2 | Class member edits hid semester standing behind a profile action, calculated the row against the globally current semester instead of the semester selected in the class header, and left point appeals outside Applications. | CSF officer workflow | Fixed in the Development candidate: the roster now shows selected-semester standing beside account, points, and meetings; each row has a named Edit action; the editor offers an optional application status change before identity fields; permitted membership officers can approve through the existing atomic application decision path; and point appeals sit below the application queue. Synthetic browser checks covered an administrator, the Vice President of Membership role, a successful approval receipt, roster count refresh, and the empty appeals state. Focused tests, typecheck, zero-warning lint, all 261 plugin test files, and the optimized build pass on the integrated local tree. Hosted Development remains a separate gate. |
| AUD-079 | P1 | Historical class tabs with compact `LastName` and `FirstName` headers, plus one Class of 2027 tab with a damaged first identity header, could not reach preview. Application review rows also opened with the profile id instead of the application subject id. The point queue omitted the canonical activity or club, club-sheet reference, club review state, configured point rule, and appeal decision. | CSF imports and officer review | Fixed in an isolated Development candidate. The deterministic parser accepts compact identity headers and recovers one missing class-history identity header only when one unclaimed identity column precedes a stable roster-key column. It never applies that inference to applications or an explicit `not_mapped` field. Read-only verification of the supplied sources parsed all 517 Spring 2026 application rows and every populated Class of 2027, 2028, and 2029 tab with zero rejected rows; Class of 2030 contains only empty future templates. One duplicate 2027 Fall 2024 roster key remains an officer conflict. The application queue now opens the application subject. Point review keeps the activity or club, claim, proof, point rule, club status and sheet, and appeal history together, with an in-place appeal decision for open appeals. Club-audit workbooks remain manual reference evidence and are not auto-imported. The member personal-calendar card and member-route calendar read are removed. The independent CSF app gate, all 263 plugin test files, TypeScript, zero-warning lint, data-access audit, route inventory, and root optimized build pass. Production and hosted Development were not changed. The local fictional stack eventually started, but authenticated organization requests repeatedly took 19 to 60 seconds and hit the fail-closed auth timeout, so authenticated screenshots remain open. The browser sessions, app runner, port claim, and generated stack were stopped. |
| AUD-080 | P1 | A ten-minute communications schedule with 25 sequential provider calls could not drain 1,000 queued messages within the release target. Webhook verification also had one unversioned secret, and topic setup loaded a provider-management credential inside the deployed application. | CSF communications and secrets | Fixed in the scale-hardening Development candidate. Dispatch now runs every minute with a 125-attempt run cap, five concurrent sends, eight starts per second, provider retry timing, and unchanged idempotency keys. The deterministic 1,000-attempt fake-provider test settles 950 accepted and 50 durable retries with zero repeated sends. Webhook verification supports an active and retained key set plus the one-release legacy fallback. Topic creation moved out of application runtime; the app reads non-secret per-environment IDs. The private plugin was published to Development at `c1bd7f2`; the full plugin gate, zero-warning lint, TypeScript, isolated database replay, and isolated production build pass. Hosted Development provider acceptance now passes on root `b80d2ed`: ten synthetic `@resend.dev` attempts were provider-accepted in 2.4 seconds, all ten deliveries settled as delivered, twenty signed sent/delivered events were recorded, the replacement key verified events, and there were zero failures, retries, unknown outcomes, worker faults, or quarantines. The old Development endpoint is disabled and the replacement remains enabled. Production endpoints and settings were not changed. |
| AUD-081 | P1 | OAuth ciphertext used one unversioned key, and no count-only worker alert covered old communication queues or unresolved background imports. | CSF secrets and operations | Fixed locally in the scale-hardening candidate. New keyring ciphertext records the active key ID, reads accept retained and legacy keys, and successful Google credential reads rewrite with an equality guard. A service-only aggregate RPC reports communication backlog older than five minutes and unresolved or blocked import work. Webhook signature failures emit a bounded alert code, and Vercel Web Analytics now runs beside Speed Insights only on Vercel. Hosted alert delivery, latency thresholds, and legacy-ciphertext counts remain release gates. Production was not changed. |
| AUD-082 | P1 | The release target lacked a repeatable 1,000-row benchmark for the real bounded import receipt path, and authenticated browser acceptance could not distinguish fast database work from a slow local auth runtime. | CSF scale acceptance | `bun run csf:test:import:scale` creates a rollback-only fictional roster, freezes the real commit decision, commits 1,000 rows through one hundred 10-row RPC batches, replays every request receipt, finalizes the attempt, and rejects any duplicate write or unknown outcome. The earlier 50-row version completed two isolated runs in 61.2 and 126.9 seconds with 1,000 profiles, zero duplicate writes, and zero unknown outcomes. Non-draft pull requests run the current benchmark after the member-scale check and before browser acceptance. The separately confirmed Production schema workflow calls the same CI preflight before its deployment job can start. The separate member-scale check loaded 1,000 profiles and 600 applications in 598 ms; its largest measured read was 83 ms. Root PR #432's first hosted replay passed the full database and scale stages, then found that a signed-in outsider could not open the class-code page because it called the member-only dashboard snapshot. Private PR #218 passed all checks and merged to private Development at `c14e4d8`; the fix recovers only that exact `42501` denial on the connect route, returns no member data, and removes the name-only candidate action. The exact root candidate `e9fa5609` then passed quality, production build, full database replay, both scale checks, DV browser journeys, 77 CSF browser tests, isolated health, and retained-trace validation. Root PR #432 merged to Development as `ccf9e687`; its Vercel deployment is Ready at the Development aliases, and the Development Supabase integration completed. The current 10-row benchmark, 90-member/10-officer hosted load, renderer heap loop, Web Vitals thresholds, and official workbook reconciliation remain required before T26 closes. Production was not changed. |
| AUD-083 | P1 | Initial class workbook linking saved every semester source and then synchronously prepared each populated tab before registering the workbook. The hosted request could time out after the source writes, leaving a class with active sources but no workbook registry or durable refresh job. The first queued candidate still called the general source action once per semester, which repeated Drive and Sheets metadata reads. | CSF workbook linking | Fixed by reading the workbook once, registering every semester source from that validated snapshot, then returning after an atomic service-only registry and queue call. The queue key includes workbook, Drive file, and provider version, repeated requests reuse one job, and a worker for a replaced Drive file cannot mark the new workbook prepared. Populated-tab previews run only under the leased worker context. Private PR #220 passed GitGuardian and the full plugin-quality job, then merged to private Development at `8e66fb5`; the local private gate passed 265 test files and the independent CSF application build. The preceding root candidate passed 6,484 database assertions, CSF workflows, architecture and data-access audits, cron safety checks, TypeScript, zero-warning lint, strict private-plugin containment, and the optimized build with CI-shaped local placeholders. Hosted Development reconciliation, officer batch approval, and Production promotion remain open. |
| AUD-084 | P1 | Class-history previews can carry a valid official roster key before any matching profile exists. The batch readiness gate blocked those rows as missing profile targets, and independent semester commits had no safe way to reuse the profile created by an earlier term. | CSF class-history identity | Fixed in the Development candidate with a source-aware readiness contract and a locked commit-time identity lookup scoped to organization, class, and official workbook. Only a valid canonical roster key can reuse a prior committed active profile. Different workbooks, invalid keys, conflicting canonical emails, and keys already bound to multiple profiles remain blocked. The immutable row and private audit trail record every reuse. Private PR #221 merged at `618a13e`; 65 focused readiness tests, 18 focused pgTAP assertions, TypeScript, zero-warning lint, migration replay, all 265 plugin test files, and the 6,502-assertion isolated database suite pass. Hosted Development deployment and count-only officer reconciliation remain required. Production was not changed. |
| AUD-085 | P1 | The background import worker stored every pre-claim refusal as `import_commit_blocked`, so an approved Development source, an expired Google connection, and a changed workbook produced the same receipt even though each requires a different operator action. | CSF import operations | Fixed in the Development candidate with a closed classifier shared by the commit action and worker route. Queue receipts and worker responses now distinguish allowlist, reconnect, missing file, trash, identity, MIME, incomplete evidence, source drift, and retryable source checks. Unknown text becomes `commit_failed`; raw provider and database messages are never persisted. Private PR #222 passed plugin quality and merged at `3faddc3`. Fifteen focused tests, TypeScript, and zero-warning lint pass. Exact root CI, hosted Development diagnosis, workbook reconciliation, and Production promotion remain open. |
| AUD-086 | P1 | The service-only class-history readiness projection runs as SECURITY INVOKER but could not execute its two pure source-key helpers. Fresh preview preparation failed with a permission denial before any row write. | CSF import readiness | Fixed in the current root candidate with a forward migration that grants only service_role execution on the two helpers. PUBLIC, anon, and authenticated remain denied. The focused pgTAP test now calls the readiness projection as service_role and passes all nine assertions. Database validation and a complete local migration replay pass. Hosted Development migration, fresh preview preparation, and count-only reconciliation remain open. |
| AUD-087 | P1 | Three activity-heavy Class of 2027 commits exceeded the hosted database's eight-second request limit before their first 50-row transaction could create a receipt. The worker failed closed, wrote no rows for those previews, and retained a retryable audit trail. | CSF import worker | Fixed in private PR #224, merged to private Development at `e7be788`, by reducing each atomic commit page to 10 rows while preserving receipt replay and the 25,000-row loop ceiling. Class Sync also forces a fresh workbook read for legacy previews that lack complete source evidence. Forty-seven focused tests, TypeScript, zero-warning lint, and the full private plugin-quality job pass. The root CI run, exact Development deployment, and count-only retry reconciliation remain open. |
| AUD-088 | P1 | The first hosted ten-row retry cleared the database request limit, then the import route reached its 60-second function ceiling before the fenced semester attempt could finalize. The database retained receipt-backed progress and did not report completion. | CSF import worker runtime | Fixed in the current root candidate by raising only the import worker to the reviewed 800-second Pro function ceiling. Atomic database batches remain capped at 10 rows, and their receipt replay contract is unchanged. A route test locks the duration. Exact CI, Development deployment, retry settlement, and count-only reconciliation remain open. |
| AUD-089 | P1 | One activity-heavy Class of 2028 ten-row transaction still reached the hosted PostgreSQL statement timeout after 150 rows had committed. PostgreSQL rolled back that page, no batch receipt existed, no row remained in flight, and 43 rows stayed frozen. | CSF import worker | Fixed in private PR #225, merged to private Development at `05a0ad7`, by splitting only a confirmed PostgreSQL statement-timeout rollback with no receipt into smaller receipt-backed batches. A missing receipt caused by any other error keeps the no-repeat rule, and a single-row timeout blocks. Three focused tests, TypeScript, zero-warning lint, and all 238 private plugin test files pass. Exact root CI, one Development deployment, and settlement of the remaining 43 rows remain open. |
| AUD-090 | P2 | Every short-lived feature branch started a Vercel build before the repository's Development environment guard refused it, consuming paid build CPU without producing a usable preview. | Vercel project configuration | Resolved for the Let’s Assist project on 2026-08-31. Provider configuration disables ordinary feature-branch deployments, and Speed Insights Plus renewal is canceled. The repository mirrors that boundary in `vercel.json`. An unmarked `development` commit may create an ignored deployment record, but it skips dependency installation and the application build. Only `[deploy-development]` or a merged `codex/csf-integration-*` branch runs that work. A `main` merge creates no Vercel deployment. The protected Production workflow builds the exact accepted tree once after its release gates pass. Focused contract tests cover feature, ordinary Development, marked Development, integration merge, Production, and explicit non-Git cases. No deployment changed in this repository follow-up. |
| AUD-091 | P1 | Six official Class of 2027 rows carried populated roster keys that did not match either normalized FirstLast or LastFirst. Preview parsing marked them pending, but the database readiness gate later blocked them without exposing an officer decision row. | CSF class-history identity review | Fixed in private PR #226, merged to private Development at `4a414c0`, and the current root candidate. Preview parsing now marks each invalid-key targetless row ambiguous and explains the choice. Officers can match an existing profile or disclose a no-match form that creates one unclaimed profile through a permission-checked, request-bound database transaction. The transaction blocks an active exact-name profile in the same class, preserves the immutable workbook snapshot, reconciles the row, and records audited receipts. All 239 private plugin test files, TypeScript, zero-warning lint, 17 focused pgTAP assertions, and the full 423-migration, 6,521-assertion isolated replay pass. The root integration remains open. Hosted Development settlement of the six rows and the two blocked semester previews is still required. Production was not changed. |
| AUD-092 | P1 | Final release review found unbounded Member Home projections, repeated Member Home enrichment reads, capability-insensitive Officer Home counts, deletable import batch receipts, incomplete workbook tenant foreign keys, and unthrottled officer profile search. The import scale fixture also covered only successful rows. | CSF release gate | Fixed in private PR #228, merged to private Development at `ef083a2`, and the current root candidate. Member Home now uses one grouped context RPC and one grouped stream-enrichment RPC, caps every profile list at 50, and keeps reply previews at three. Officer Home returns each count only when the actor holds its matching permission. Composite tenant foreign keys bind workbook and refresh-job ownership. Approval and settlement append immutable count-only audit events, while service-role deletion of approval, item, and commit receipts is denied. Officer profile search consumes the atomic account and address limiter after authorization. The fictional 1,000-row benchmark now refuses stale, ambiguous, unknown-outcome, and duplicate cases before completing 100 receipt-backed batches in 2.3 seconds with zero repeated writes or unknown outcomes. The fresh local gate passed 268 plugin test files, TypeScript, zero-warning lint, 428 migration replay, 6,557 pgTAP assertions, CSF workflows, the 1,000-member benchmark, and the 1,000-message fake-provider test. Hosted Development session load, renderer heap, and Web Vitals acceptance remain open, so T26 stays in progress. Production was not changed. |
| AUD-093 | P2 | Claim-time import refusal could close only the worker queue while leaving its frozen approval item open. Concurrent row-batch deliveries could race before receipt insertion, and a refresh whose Drive owner disappeared could leave its workbook marked linked. | CSF background queues | Fixed in the current root candidate through forward migration `20260901070000`. Both import refusal branches settle the queue, batch item, parent counts, and audit together. Row-batch receipt lookup is serialized by organization and request id. Missing Drive owners block the refresh job and workbook registry. Migration replay, 67 focused pgTAP assertions, the architecture audit, plugin-isolation audit, TypeScript, zero-warning lint, and the hosted-load harness contract pass locally. Exact CI, hosted Development load acceptance, and Production promotion remain open. |
| AUD-094 | P1 | Member Home formatted activity timestamps in the runtime's default timezone. Vercel rendered UTC text while a Pacific browser rendered different text, so every Home visit recovered from React hydration error 418. The staff presentation toggle also pushed a new history entry and forced a second route refresh, retaining repeated App Router payloads during the 25-navigation memory check. The hosted load tool launched all 100 requests at once instead of ramping to 100 active sessions. | CSF member Home and hosted load acceptance | Fixed in the current private and root candidates. Feed activity and month labels now use deterministic Pacific date parts. The presentation toggle replaces its current history entry with one route request. The hosted test ramps 90 member and 10 officer sessions over 60 seconds, begins browser mutations at peak load, and accepts either persisted starting view. The UTC/Pacific browser probe reproduced five hydration errors only in Pacific before the fix. Forty-nine focused plugin tests, all 239 private plugin test files, TypeScript, zero-warning lint, and the hosted harness contract pass. Exact CI, one Development deployment, and the 15-minute hosted load gate remain open. |
| AUD-095 | P1 | Final Production review found that a pending profile link could receive the full student snapshot, classmate counts did not require current-term class membership, activities could cross overlapping terms, provider pacing restarted for each organization pass, and an outer deadline could return while a claimed email pass still held work. | CSF member privacy and communications | Fixed in the current root candidate. Forward migration `20260901103347_csf_member_snapshot_scope_hardening.sql` returns only pending status fields until verification, hides classmate counts without current-term class membership, filters each activity through the viewer's matching term membership, and keeps both underlying projections owner-only. The communications route now owns one provider-start limiter per invocation, stops provider work at the work deadline, allows one bounded settlement drain, and aborts every database transport before the route ceiling. If settlement cannot finish, the durable lease remains for the next recovery pass and the worker never blindly resends it. A clean 430-migration replay, 143 focused pgTAP assertions, 48 communications tests, TypeScript, zero-warning lint, strict private-plugin containment, and the optimized Production build pass. The second generated Docker stack failed during local startup and disrupted the Supabase test wrapper, so fresh-runner CI and exact hosted Development acceptance remain required before Production promotion. |
| AUD-096 | P1 | The hosted scale script copied two authenticated cookie sets across 100 request loops, and the Production schema workflow neither required nor produced exact-SHA hosted acceptance. | CSF release gate | Fixed in the current root candidate. The hosted script mints 90 member and 10 officer SSR sessions, checks all 100 `session_id` claims for uniqueness, and passes one cookie set to each request loop. A manual Development-only GitHub workflow requires the exact Development head, exact Vercel Preview check, and exact configured Supabase Preview check. It provisions only the fixed `csf-load-fixture` tenant, exchanges the step-scoped Vercel bypass secret through one manual same-origin redirect for a Secure HttpOnly cookie, runs the hosted gate, rechecks the head, and publishes the acceptance status. Production requires ancestor and tree equality plus a successful status created by `github-actions[bot]` from this repository's Actions run. Focused contracts and isolated fixture replay pass. Exact CI, the 15-minute hosted run, and Production promotion remain required. |
| AUD-097 | P1 | The class Members search input had no submit listener or visible submit control. Typing changed the field but never updated the URL-backed server query, and an eventual form submit did not preserve the selected term, filters, sort, or view. | CSF member directory | Fixed in private PRs #235 through #237, merged to private Development at `7a7936d`, and integrated through the exact root gitlink. The controlled field debounces a server request after two characters, has an explicit Search button, reloads on clear without retaining an empty query, resets paging, and retains class, term, standing, account, sort, and view parameters. The directory query remains organization and class scoped, case-insensitive, and bounded. Twenty focused component tests pass with 107 assertions, private TypeScript and zero-warning lint pass, and a fresh isolated browser run passed all seven selected journeys, including typing, Search, Enter, Clear filters, and empty-input clearing. Hosted Development and Production acceptance remain open. |
| AUD-098 | P1 | The class join page could show one exact account-name candidate, but the confirmation click exposed no settled result. Its fallback wording also made the name-only review boundary unclear. | CSF student connection | Fixed in the private release candidate and exact root candidate. The passive card shows only the record name and class. **Yes, this is me** submits its short-lived signed snapshot, and the service-only database action creates or reuses one officer request after rechecking the active code, current account name, sole active unclaimed candidate, one active class membership, claim state, and organization access under lock. No passive or typed name connects a profile; only one exact verified-email record may connect automatically. Focused UI and token tests pass, six class-code browser cases pass on a fresh isolated stack, and the current migration replay evidence is recorded with the final release gate below. Hosted Development connection and queue acceptance, and Production promotion, remain open. |
| AUD-099 | P1 | The application importer retained a source-level graduating class for one chapter-wide response workbook. Rows from other classes entered reconciliation under stale scope, while source reuse could follow a mutable title instead of the Drive file identity. | CSF application import | Fixed in the current private candidate. Application sources clear fixed-class scope, reuse the saved source by immutable Drive file id, increment the mapping version, and derive the configured class and term for each immutable preview row. Multiline course responses split into separate course records, and a recognized aggregate-points header maps deterministically. Official class workbooks follow the same file-id and provider-version identity rule; titles remain display text. Local parser coverage passes without retaining source rows. Exact root integration, hosted Development application import, official workbook reconciliation, one officer batch approval, and Production promotion remain open. |
| AUD-100 | P1 | The final class-code join and passive account-name confirmation functions took user, code, request, and profile locks before the shared organization identity lock. A concurrent import, edit, or merge could change profile ownership after the connection path checked it. Their settled-success replay branches also trusted stale profile, organization-access, class, link, request, or audit state. | CSF identity locking | Fixed by forward migration `20260902010000_csf_class_join_identity_lock_order.sql`. Both service-only entry points now take the organization identity lock first and delegate to owner-only historical bodies. Replayed success is revalidated after delegation. Drift revokes only the exact stale verified link, reopens the same non-rejected request, and records non-PII blocker codes. Public and client roles, including `service_role`, cannot call the bases or revalidation helper directly. The focused database set passes 95 assertions, including same-organization blocking, cross-organization independence, and replay drift. The complete isolated replay passes 6,721 assertions across 435 migrations, and 43 focused static tests pass with 874 assertions. Hosted Development and Production acceptance remain open. |
| AUD-101 | P1 | A mapping-only source edit did not invalidate an older ready preview because commit-time evidence checked the workbook revision but did not compare the preview's frozen mapping version with the current source mapping version. | CSF import commit fencing | Fixed by forward migration `20260902020000_csf_import_mapping_version_fence.sql`. Batch approval classifies only the affected preview as stale, while other ready previews continue to the queue. An exact request ID still replays its frozen approval receipt. The final worker claim locks and rechecks the current mapping before it consumes source evidence or freezes any row. The new owner-only helper and batch implementation have no client or service-role grant; the two reviewed service entry points retain explicit service-role-only execution. The 15 focused pgTAP assertions cover exact, legacy, malformed, mixed-batch, replay, and post-approval drift cases. A fresh isolated run passed all 434 migrations, 229 pgTAP files, and 6,712 assertions, and 30 focused cutover and documentation contract tests passed with 706 expectations. This is local evidence only. Hosted Development, exact-tree CI, official workbook reconciliation, and Production remain open. |
| AUD-102 | P1 | Seven workbook and import queue tables inherited full `service_role` table privileges from the `plugin_data` default ACL. Their creation migrations granted narrower sets without first removing inherited rights, and even those sets exceeded the runtime's three direct SELECT call sites. The excess included REFERENCES, TRIGGER, TRUNCATE, INSERT, UPDATE, and receipt deletion. | CSF queue table ACLs | Fixed by forward migration `20260902030000_csf_queue_table_least_privilege.sql`. It removes every explicit client and service grant, then restores SELECT only for the workbook registry, workbook refresh jobs, and import commit queue used by worker-context validation. Every function that reads or writes the other four tables executes as the database owner. RLS remains enabled and browser roles retain no table privilege. A fresh isolated run passed 435 migrations, 230 pgTAP files, and 6,721 assertions, then stopped its owned stack. The default local database replay passed, and the exact executable Production-shaped preflight passed all blockers at 435 rows, head `20260902030000`, and a 21-row tail. Forty-four release contract tests passed with 1,057 expectations, 23 focused worker/import tests passed with 55 expectations, and TypeScript passed. This is local evidence only. Hosted Development, exact-tree CI, and Production remain open. Future `plugin_data` worker tables must revoke inherited service defaults before exact regrant; changing the global default ACL requires a separate complete schema audit. |
| AUD-103 | P1 | Two officers could read one source mapping version, save different mappings concurrently, and assign both previews the same version. The registry computed the version before the database row lock, while meeting attendance kept its header digest only in the preview. A later mapping or header snapshot could therefore replace the first under the same version and evade the `20260902020000` commit fence. | CSF source mapping concurrency | Fixed in the current private and root candidates. Forward migration `20260902040000_csf_sheet_source_mapping_version_serialization.sql` stores a bounded header digest, validates each material mapping change as an atomic compare-and-swap under the locked source row, rejects stale or skipped versions, and keeps exact replays stable. The material identity includes class, source type, target and duplicate policies, column and tab mappings, commit targets, and the header digest. Rollout advances sources with unsettled source-backed previews so the existing commit fence refuses pre-boundary work. The private importer now advances the first material mapping on an existing source and derives meeting-attendance versions from the stored and requested material fingerprints. The focused database test passes 41 assertions, including queued concurrent writers, exact replay, stale lower versions, bounded create versions, header drift, and the `20260902020000` preview fence. The migration replay, exact 436-row local preflight, target-schema verifier, 52 root contracts with 1,145 expectations, 16 private contracts with 90 expectations, private TypeScript check, and both diff checks pass. Hosted Development, exact-tree CI, and Production remain open. |
| AUD-104 | P1 | A workbook refresh worker could keep preparing an older Drive generation after another check advanced the workbook. Its completion path could then overwrite the current discovered-tab snapshot and prepared version. Null lease values and a different officer's OAuth identity were also insufficiently fenced. | CSF workbook refresh generation | Fixed by forward migration `20260902050000_csf_workbook_refresh_generation_fence.sql` and the private refresh wrappers. Claims bind the exact workbook, Drive file, provider version, stored OAuth owner, worker actor, and non-null lease token. Heartbeats extend only that generation. Preview open, failure, publication, and refresh settlement all recheck the same generation, and a stale worker receives a retryable `workbook_refresh_generation_lost` receipt without overwriting current workbook state. The focused generation and publication contracts cover 103 assertions. Hosted Development, exact-tree CI, and Production remain open. |
| AUD-105 | P1 | The import worker could convert an unknown or retryable database failure into a terminal row receipt, while an expired retry could either starve fresh approvals or leave its batch item and parent counts unsettled. Opposite-order batch approvals also lacked a proved lock order. | CSF import worker settlement | Fixed by forward migration `20260902060000_csf_import_row_batch_error_boundary.sql`. The bounded row-batch function records only closed constraint refusals, rethrows unknown and retryable failures without a receipt, reconciles a completed logical commit before new authorization work, prioritizes expired work with a five-attempt cap, and settles the current queue item plus parent counts under lock. Batch approval locks preview IDs in database order. Focused queue, source-settlement, and concurrency contracts cover 88 assertions. Hosted Development, exact-tree CI, load acceptance, and Production remain open. |
| AUD-106 | P2 | The class Members table displayed `First Middle Last`, but both paged profile RPCs omitted `middle_name` from their combined-name search expression. A member could be visible in the directory while an exact search for the displayed name returned no result. | CSF member directory | Fixed in `20260902010000_csf_class_join_identity_lock_order.sql` without changing either public function signature or grant. Both organization and class profile searches now use preferred name plus last name when a preferred name exists, otherwise first, middle, and last name. Individual field, email, class, status, tenant, cursor, and page-size filters remain in place. A clean 438-migration reset, 36 focused pgTAP assertions, and 30 search contracts with 713 expectations pass locally. Hosted Development browser acceptance and Production promotion remain open. |
| AUD-107 | P1 | On a canonical class URL without `csf_semester_term`, the class header used the validated current-or-newest semester while the Members query used only the raw URL term. The page could therefore label one semester and report zero active members from another scope. | CSF member directory | Fixed in private PR #240, merged to private Development at `7597fdc`, and staged in the current root candidate through the gitlink. One service-only class-directory RPC now returns the full non-archived class history, the exact selected-term participation state, counts, and progress before filtering or paging. A second grouped RPC replaces the remaining per-class count fanout. Directory keeps transferred records and excludes archived records; Current semester includes accepted, active, completed, and not-completed participation. The 55-profile regression proves that a full-name and middle-name search finds a target absent from the first 50 unfiltered rows while keeping the 55-directory and selected-term counts stable. Twenty pgTAP assertions and 54 focused private tests pass, including behavioral coverage that omits the selected class only from the grouped count call while retaining every active class in join-code lookup. The integrated root TypeScript and zero-warning lint gates pass, the complete mock-isolated private runner discovers and passes all 257 plugin test files, and the complete root isolated gate passes 440 migrations with 6,971 database assertions. Hosted Development search/count acceptance and Production promotion remain open. |
| AUD-108 | P1 | The hosted load workflow referenced account-pool secrets that it never provisioned, navigated the real DVHS organization, and injected the Vercel bypass secret into browser request headers where redirect propagation could expose it outside the trusted origin. | CSF release gate | Fixed in the current root candidate with a deterministic `csf-load-fixture` tenant containing 1,000 fictional profiles and exactly 100 fixed Auth identities. Provisioning rejects Production, the real DVHS handle, cross-tenant fixed IDs, and auth-directory enumeration. Browser acceptance exchanges the bypass secret in one manual same-origin request, follows no redirect, installs only a Secure HttpOnly cookie, and blocks document navigation outside the exact fixture route. The fixture provisioner was replayed twice against a fresh isolated stack with identical count-only output. Fifteen focused tests pass with 279 assertions, and syntax, ESLint, formatting, YAML, and diff checks pass. No hosted provider action has run; exact CI and hosted Development load acceptance remain open. |
| AUD-109 | P1 | Separately prepared class-history tabs could create another profile for the same workbook key. The first reuse repair then treated a normalized student name as a stable key when both rows lacked contact data, so two students with the same name could be merged. | CSF import identity | Fixed by forward migrations `20260902201108_csf_class_history_source_key_atomic_reuse.sql` and `20260903043000_csf_source_key_contact_corroboration.sql`. The commit path takes the organization identity lock and reuses a prior profile only when organization, workbook file, class, source key, immutable normalized name, and school or personal email agree. A repeated name-only key returns no automatic target and the locked write routes it to officer review. Divergent and multi-profile mappings remain blocked. Focused pgTAP covers contact-corroborated reuse in one statement, workbook and class isolation, name-only refusal, and conflict refusal. Exact-tree CI, hosted Development reconciliation, and Production remain open. |
| AUD-110 | P1 | Hosted Development acceptance first used Vercel management endpoints that the GitHub token could not read. After that gate was removed, the first complete 100-session run found that staff view switching forced a server write followed by a second full document request, while the browser monitor counted deliberate Chromium navigation cancellations as errors. | CSF release gate | PR #456 passed exact CI and merged at `7185f210`. Its sole Development build reached ready, and the runtime verifier accepted the exact Preview SHA without a management token. The hosted run provisioned the fixed fictional tenant, minted 100 distinct identities and sessions, and completed 9,426 requests with zero request errors and zero 5xx responses. Read p95 was 2.25 seconds, read p99 was 3.48 seconds, LCP p75 was 1.87 seconds, INP p75 was 48 milliseconds, CLS p75 was 0.0021, renderer crashes were zero, and retained heap fell 23 percent. The run failed because view-switch mutation p95 was 4.25 seconds and the monitor counted 282 browser events without separating navigation aborts. The follow-up uses App Router route replacement after the same authorized preference write, ignores only explicit `net::ERR_ABORTED` cancellations, and emits count-only browser error categories. Focused private and root contracts pass. Exact CI and one replacement hosted run remain required. Production was not changed. |
| AUD-111 | P1 | The workbook generation-fence rollout intentionally blocked current registries for reprepare, but the metadata-check claim rejected every blocked registry. Officers saw four failed checks and no refresh job could start. | CSF workbook recovery | Fixed by forward migration `20260903032246_csf_import_approval_trigger_owner_acl.sql`. Only `workbook_generation_reprepare_required` may claim a metadata lease; unrelated blocked and unlinked states remain closed. The same migration supplies the missing owner ACL for both import-approval trigger functions. Focused pgTAP covers the recovery lease and grants. Hosted Development applied the migration, completed four metadata checks, and settled four current refresh jobs. Each official registry is linked, current, error-free, and records eight discovered tabs. Production remains unchanged. |
| AUD-112 | P1 | Generation-bound source registration returned a sixth implementation field through a closed five-field worker receipt. The database write succeeded, but the worker rejected the response as untrusted and left the refresh outcome unknown. | CSF workbook refresh receipt | Fixed by forward migration `20260903032631_csf_class_workbook_source_receipt_contract.sql`. The generation-aware implementation is owner-only and the service-role wrapper returns the exact five-field receipt. Focused pgTAP proves create and reconfiguration responses remain closed. Hosted Development applied the migration and prepared 12 populated previews from the four current workbooks. The previews contain 1,908 ready rows, one error row, and one skipped row. No real row was committed. The two non-ready rows remain officer work. Production remains unchanged. |
| AUD-113 | P1 | The two hosted Development repairs were applied through the management API under generated migration versions that differed from their repository filenames. Supabase correctly rejected the exact-tree release because the remote ledger contained versions absent from the repository. | CSF release ledger | Fixed in PR #459 by aligning the two unreleased filenames to the versions already recorded by hosted Development, without changing their SQL. The cutover ledger now includes 443 migrations and the contact-corroboration repair as the 29th Production-pending migration. Local replay, lint, and focused release contracts pass. Hosted exact-tree acceptance and Production remain open. |
| AUD-114 | P1 | The exact Development load gate completed 9,586 requests with no request or browser errors, but the staff member-or-officer view switch measured 3.84 seconds at p95 against the three-second mutation limit. Its Server Action repeated authentication, membership, plugin access, and permission reads before writing one presentation-only preference, then invalidated a route before the required route replacement. | CSF hosted performance | Fixed in private PR #242, merged to private Development at `2affd09`, and staged in the current root candidate with `public.set_csf_staff_view_mode(uuid,text)`. One authenticated database transaction now checks the active host staff role and updates only the caller's preference. The preference still grants no authority. The action no longer repeats the four authorization reads or invalidates the route cache. Client execution is limited to `authenticated` and is included in the architecture allowlist. Private CI and all 257 discovered plugin test files pass. The clean local replay applied every migration, passed 238 pgTAP files with 6,989 assertions, completed the database workflow, architecture, plugin isolation, registry, runtime, browser-isolation, and cron-shape gates, and removed its owned stack. The production build also passes. Replacement hosted acceptance remains open. |

| AUD-115 | P1 | Annotation and identity review could each prevent the other from completing because they shared a terminal resolution field. | CSF import review | Forward migration `20260906041507` passes both review orders, preserves each decision and immutable source data, and leaves unmatched identities blocked. Hosted acceptance passed at `60825d2d`. Production remains open. |
| AUD-116 | P1 | `db:validate` invoked a shared-local reset without an isolated ownership check. An interrupted run left the shared database container and volume absent. | Local tooling | File validation is now non-mutating, with three hermetic regression tests. The owned isolated CSF database is unaffected. Previous shared-local contents and recoverability remain unverified; recovery is open. |
| AUD-117 | P1 | Annotation review could change frozen import decisions after a stopped worker, and could settle rows before preview preparation completed. | CSF import review | Forward migration `20260906053114` rejects frozen rows and unfinished previews. Nine regression failures now pass within 47 focused assertions. Hosted acceptance passed at `60825d2d`. Production remains open. |
| AUD-118 | P1 | Inline point approval and rejection omit the required request ID and fail with `Invalid input`. | CSF officer review | Private PR #257 adds stable receipts and unknown-outcome handling. Five focused tests, 266 plugin test files, and the fictional approval/reload journey pass. Root #486 and private promotion #258 merged. Hosted acceptance passed at `60825d2d`; public release remains open. |
| AUD-119 | P1 | Opening point verification freezes officer decisions as well as student edits. | CSF point review database | Forward migration `20260906062954` permits authorized decision-only updates and preserves the claim freeze. The review-period assertions, fictional approval/reload journey, full replay, and exact release catalog pass. Hosted acceptance passed at `60825d2d`; Production remains open. |
| AUD-120 | P1 | The release catalog verified the point-freeze function but could accept a missing, disabled, or replaced trigger. | Production release verification | The catalog pins the installed trigger and its execution conditions. The unit regression passes, and isolated replay rejects eight trigger changes. Merged and hosted-accepted at `60825d2d`; Production remains open. |
| AUD-121 | P1 | Direct server table updates could record point decisions without canonical review evidence or a request receipt. | CSF point review database | Forward migration `20260906073357` removes runtime UPDATE grants. Canonical server-role approval/retry and direct-write refusal pass. The release query rejects restored table or column grants. Merged and hosted-accepted at `60825d2d`; Production remains open. |
| AUD-122 | P1 | Removing runtime point UPDATE permission breaks the local fixture upsert. | Isolated fixture seeder | The awaited fictional fixture reset now precedes INSERT instead of upsert. All 31 seed tests, fresh seed, and reseed pass with the same four point rows. CI `34021317555` and hosted acceptance `34021315408` passed on merged `60825d2d`. |
| AUD-123 | P2 | Identity reconciliation accepts rows before preview preparation finishes. | CSF import review | Six failures reproduce matches and audit writes on pending, running, failed, and cancelled previews. Forward migration `20260906085350` adds the locked preview-state check. The final full replay passes 460 migrations and 7,159 assertions, the exact release catalog, and all ten permission/trigger drift refusals. Hosted and Production rollout remain open. |
| AUD-124 | P2 | The browser suite skips the retired historical roster importer but does not replace it with a full class-workbook prepare, review, and commit journey. | CSF browser acceptance | Run `34093192415` passed 87 tests but skipped this legacy test plus three optional galleries. The replacement test checks only that the retired button is absent and the Linked spreadsheet heading is present. Live Chrome access is restored. The fictional workbook is linked with eight terms and preparation passed in run `34174922514`. Review exposed AUD-129; commit and unchanged repeat-sync remain open. Database tests are separate evidence. |
| AUD-125 | P2 | Classes computes the Terms-only closure readiness preflight, which averages about 1,094 ms in Development database statistics. | CSF route performance | Fixed and verified in hosted Development on `e8e4c63b` with private `ef8cce1`. Run `34171163941` reports Classes p95 1,577.239 ms and Applications p95 1,903.888 ms across 100 distinct sessions, with zero errors. Terms authorization and lifecycle checks remain intact. The prior failed measurements remain recorded. Production promotion is still open. |
| AUD-126 | P2 | A cancelled email campaign still shows a review-blocked notice after every refused attempt received a final officer determination. | CSF communications UI | Fixed locally with a shared display predicate. Six rendered cases preserve unresolved-receipt warnings even for terminal campaigns while removing historical holds from resolved terminal history. Five cases failed before the fix. No receipts, campaign states, or retry controls changed. TypeScript, lint, and all 271 private-plugin test files pass. Hosted verification remains open. |
| AUD-127 | P2 | Application course parsing treated standalone empty answers as course names, hiding missing course data. | CSF application import | Eight fictional tests failed before the local parser fix. The supplied Fall export contained 59 such course cells; 16 responses now expose missing course data. Raw source evidence and paired-grade positions remain intact. Focused tests, TypeScript, and zero-warning lint pass. Hosted acceptance and grouped Production release remain open. |
| AUD-128 | P1 | Vercel metadata showed a general `CRON_SECRET` shared across local Development, Preview, and Production, despite separate dedicated CSF worker keys. | Provider environment isolation | Configuration repaired. Development and local development have independent cron values; the existing Production value stays Production-only. GitHub Development stores matching cron and dedicated workbook/import keys. Development deployment `dpl_AeV3QCXGTexX5oupuYBMFPHuKSAF` uses the replacement configuration. Workbook authentication and one fictional preparation passed. Dedicated import authentication and cross-environment cron refusal remain open. Development workers are disabled at revision 4. |
| AUD-129 | P1 | Computed All Reqs Met cells block complete class-history rows. The parser fix emits requirement evidence that the database append RPC rejects as an unknown field. | CSF formula and import review | Parser fix deployed to Development at `8a48f7a1`, but live rebuild `34178593288` failed at the database evidence contract. Add a reviewed forward migration and real append-RPC regression covering the new bounded field and its digest. Preserve strict identity, activity, meeting, and application formula checks. All workers are disabled; no fictional rows committed. |

## Production release evidence, September 6, 2026

### Follow-up in progress: remove scheduled publishing

The user withdrew scheduled publishing from the release scope. Local changes
remove the composer schedule choice and date field, reject scheduling inputs
before a post write, remove the Vercel cron and manual publisher workflow, and
replace the legacy endpoint with an authenticated no-write retired response.
Environment and stored flags cannot enable this endpoint. The release tool
refuses activation but still permits an explicit shutdown. Existing post and
audit history remains unchanged.

TypeScript, zero-warning root lint, 40 focused scheduling/action tests, and 10
runtime-transition tests passed. The 1,000-message fake-provider test and focused
communications worker, dispatch, environment, keyring, and webhook suites passed.
These are local checks, not hosted or provider acceptance. No deployment or
Production mutation occurred for this follow-up.

Forward migration `20260907000344_retire_csf_scheduled_publishing` now records
the return to drafts, preserves content and receipts, replaces the database
publisher with a no-write compatibility function, and rejects scheduling
through the mutation wrapper, lifecycle trigger, and runtime control setter.
The conversion helper is operator-only and idempotent. The isolated 461-ledger
replay and all 244 pgTAP files passed, with 7,120 assertions. The first replay
failed on a SQL delimiter error; the corrected fresh replay passed. Neither run
touched hosted databases.

The plugin suite passed across 295 files after updating two obsolete scheduling
contracts. The complete plugin verification command, including application
package checks and build, passed. The first root suite found stale ledger and
operator-copy contracts; the corrected full rerun passed across 301 root files.
TypeScript and zero-warning lint passed. The final migration bytes replayed on
a fresh isolated database, and all 7,120 pgTAP assertions passed again. The exact
generated release catalog query returned success against that database. A new
catalog regression pins all five retired/replacement functions and their grants.
The root application build subsequently passed in the provider-disabled isolated
environment using Webpack. Compilation reported dynamic-dependency warnings in
PDF extraction, the cron auth probe, and the AI SDK dependency chain. These are
build warnings, distinct from the passing zero-warning lint check.

Private PR #259 merged into private `development` as
`6063cce70ffd05cd940c713a1fe22517b33703aa`. Its first hosted check caught a
whitespace-sensitive copy assertion after formatting. Test-only correction
`601e0582f4e110017b788eda1fdfa2a8c953d028` passed 71 focused tests; the hosted
rerun `34074412216` passed. GitHub merged without waiting for that non-required
check. Private PR #260 then corrected legacy server-error text and its refusal
contracts. Its check `34074872970` passed before merge. The root index now pins
private Development `dbc3a79a8a87b345dc142b1a3c62e779eaa7a0fd`; its strict
ancestry and cleanliness check passed. Local database advisors reported no issues.
The first root build was stopped with exit 143 after the default Turbopack build
stalled. A replacement uses the existing isolated runner's Webpack mode with
providers disabled. The Webpack build completed with exit 0, including TypeScript,
static generation, and sitemap generation. The stopped Turbopack attempt remains
recorded separately.
No root follow-up has been published.

Development email acceptance setup added the existing fictional admin account
to the marked load-fixture tenant. The transaction verified all 1,010 profiles
as synthetic and wrote a `fictional_acceptance_access_prepared` audit event.
This temporarily added one test organization membership, taking that fixture
from 100 to 101. Before hosted load acceptance, the membership was removed in
an audited transaction tied to its original setup receipt. A count query
confirmed exactly 100 fixture memberships again. The first removal statement
failed type checking and made no change; the corrected transaction succeeded.
The browser verified officer access
and the communications settings page. No campaign or test message was sent.
Four fictional acceptance topics now exist in Resend. Vercel variable
`CSF_RESEND_TOPIC_CONFIGURATION` contains only this fictional tenant's mapping,
scoped to Preview on the `development` branch. No prior configuration existed
under that key. The next grouped Development deployment must load it before
the audited settings action can persist the mapping. No Production environment
variable changed. The bounded ten-recipient audience and delivery proof remain
open. Official chapter permissions and Production data were not changed.

Root commit `b88da0a0` is published in PR #488 against `development`. Its Vercel
build was cancelled by the ignored-build policy. CI run `34075522903` passed
quality but failed during fictional platform seeding: the expanded officer post
still requested scheduling. A new regression reproduced the defect. The fixture
now creates a draft with a null scheduling timestamp; scheduled meeting sessions
remain unchanged. All 32 seed tests, focused zero-warning lint, and the actual
seed against the owned isolated 461-migration database passed after the fix.
The next run, `34075979549`, exposed an unrelated test-observation race in
`csf_post_reply_concurrency.test.sql`. Warming the activity snapshot before
dispatch reproduced its failed lock-wait assertion locally. Both polling loops
now clear the statistics snapshot, retaining the warmed-snapshot regression.
All ten concurrency assertions pass, including authorization recheck and no
write after revocation. Application code and database functions did not change
for this correction. The corrected hosted rerun remains open.
Supabase automatically created a
nonpersistent, schema-only PR preview
with `with_data=false`. It was removed immediately through the branch API to
honor the no-extra-hosted-branches requirement. Persistent Development and
Production were not removed or reset. This deleted only the temporary PR
database and its in-progress migration replay, not application records.

Read-only provider checks found the replacement Development and Production
webhooks enabled and four legacy endpoints disabled. Development has 11 accepted,
13 delivered, and 11 failed dispatch attempts. Production has no campaigns or
dispatch attempts. Development has one scheduled post and Production has none.
These counts are not new delivery proof. No messages were sent or replayed.
The dedicated Development load tenant contains 1,010 fictional profiles and no
Resend test-address profiles. Its existing audience is not the requested
ten-recipient delivery fixture and must not be used for a general send.

Still required: finish the controlled Resend proof and remaining application
and profile reconciliation, complete browser/media and full root acceptance,
then run the grouped hosted acceptance and release. Only the private follow-up
has merged. No follow-up app has deployed, and no hosted migration has applied.

PR #483 merged as `82ab06b6c6354c1d7cefed46b73687f75e58e714` with the identical tree as accepted Development `b5edca7156a0a0d881f5e650cf895b466835dedd` and private gitlink `e03130c5355ad01a0b7a9fde723d2dbc35ee9031`. The fixed AUD-123 review thread was resolved after acceptance. Branch protections were not changed.

Hosted run `34024436926` retains both attempts. Attempt 1 failed LCP at 2.568 seconds. Attempt 2 passed on the unchanged deployment with 9,619 requests, zero errors, read p95 1.854 seconds, mutation p95 2.348 seconds, LCP p75 1.704 seconds, and 25 review navigations without crashes. Retained heap fell 11.6 percent.

Forward-migration run `34058023928` applied exactly nine reviewed migrations, advancing Production from 451 to 460 through `20260906085350`. The exact catalog passed and workers remained disabled. No export, restore, or historical migration edit occurred.

App-only run `34058086857` built Production once, passed staged checks, promoted `lets-assist.com`, and passed exact public alias and application checks. Current deployment is `dpl_8P2hHJAPCLLkyH6NdpxDw2HmPjtF`; prior deployment `dpl_GowA9smuAXNxsoifTQcn6qKMo6se` remains the app rollback target. AUD-115 and AUD-117 through AUD-123 now have Production code/schema release evidence. Official data and live workflow acceptance remain open.

The post-release count-only check found four linked workbooks, 32 discovered tabs, four current prepared versions, no workbook errors, and five completed refresh jobs with no pending refresh backlog. Runtime transition `34058344966` enabled workbook refresh for the exact public SHA. The officer UI rebuilt Class of 2027 Spring 2026 as preview `25d71cf8-3f28-40ec-9b2b-67466780ca98`, preserving 166 settled rows as superseded and preparing one retry row with an existing target and no parser errors. Officer batch approval froze that preview. Runtime transition `34058592610` enabled import processing, and queue receipt `923812f5-bcc4-442d-a672-4c1a15fa50e3` completed. The original failure receipt remains unchanged. Communications and scheduled publishing remain disabled pending their acceptance checks.

The Class of 2028 Fall 2025 row review followed an existing recorded profile merge into an active same-class target with seven committed source rows. The officer action stored `matched_existing_profile` with an evidence reason. Batch queue `14f339c4-6c1b-42d1-baef-532926c61b90` completed all 193 rows, one created and 192 updated. This did not merge the separate same-name account/profile pair, which remains an identity exception.

Fresh 2029 and 2030 Drive revision checks queued and completed workbook preparation. Class of 2030 retains eight tabs and zero source rows. The two fresh 2029 previews matched all 150 prior source values and targets exactly. Both new commit receipts completed without retrying the two obsolete failure receipts. Before and after counts were identical: 1,047 total profile rows including merged history, 1,578 activity definitions, 4,434 participation entries, 1,913 term memberships, and 1,392 attendance records. These are database totals, not active-member counts.

All 4,434 imported activity entries match their immutable source labels and numeric points and have same-organization, same-term catalog links. All 1,392 imported attendance records have valid term-meeting links. The count-only 32-class-term report remains an ignored local artifact, `production-reconciliation-82ab06b6.json`. The one Class of 2027 Fall 2024 skipped source coordinate carries a duplicate warning: the retained same-key row has five activities, the skipped row has none, and their two meeting entries match. There is no separate officer resolution note on those historical skip receipts; preserve that distinction. Applications are still pending import. Form-response emails remain evidence rather than verified canonical profile contacts. Speed Insights Plus was rechecked in Vercel billing and remains disabled.

### Scheduling retirement Development rollout, 2026-09-07

PR #488 passed CI `34076303027` on `fe7b779f859c39ad7f5ea429b6f4d2e2b268b3f6`.
Quality, database replay, browser workflows, and code analysis passed. The
reviewed PR merged into Development as
`54c95cf651161dc00d58196eca89962216865a97`, after private Development
`dbc3a79a8a87b345dc142b1a3c62e779eaa7a0fd`. The release marker started one
Development deployment, `dpl_G3JVB8U1fpyqBBGFMVkVqqGfRs4L`, and hosted
acceptance run `34077477140`. The deployment reached READY and owns
`dev.lets-assist.com`; hosted performance acceptance was still running at this
checkpoint. Supabase's exact Development check passed.

Run `34077477140` subsequently failed the hosted latency gate on the same
Development SHA. Across 9,511 requests from 100 distinct sessions, read p95 was
3,156.58 ms, read p99 was 8,192.85 ms, and mutation p95 was 4,829.83 ms. Ten
requests failed, an error rate of 0.105 percent; no HTTP 5xx responses were
recorded by the load test. Browser checks passed: LCP p75 2,032 ms, INP p75
48 ms, CLS p75 0.00210, 25 review navigations, zero crashes or browser errors,
and retained heap growth of -11.89 percent. This failed run remains evidence;
the release is not accepted for Production.

Read-only Vercel log counts for the load interval showed no warning, error, or
fatal entries. Database statement statistics are cumulative since August 2,
not scoped to this run, and do not establish its cause. The slowest cumulative
CSF read was semester-closure readiness, but its loader is restricted to the
semester administration route, which this load does not exercise. Do not assign
the failure to that function without new route-specific evidence.

Local test-only diagnostics now split read counts, p50/p95/p99, and outcomes
by fixed member/officer route labels. They distinguish HTTP failures from
timeouts and transport failures without retaining URLs, cookies, identities,
or error messages. Ten focused tests, TypeScript, formatting, and targeted
zero-warning lint pass. The first TypeScript run caught missing optional-field
annotations in the diagnostic helper; the corrected run passed.
Acceptance thresholds are unchanged. No additional deployment or load rerun
has been started for this diagnostic change.

Development applied migration `20260907000344`, reaching 461 migrations.
The exact application schema catalog passed. The ordered migration version list
also matches the checked-out release, with comparison digest
`3459adf4dcd1c5893d7bb9bb1119258d`. One scheduled post returned to
a draft with one retirement audit receipt; zero scheduled posts remain.
Production has not received this follow-up migration or app release.

A separate fictional delivery tenant now contains ten distinct Resend test
recipients and ten term memberships. Fixture setup and cohort correction have
audit receipts. The load-test tenant remains at 100 organization memberships.
The Development-only topic configuration now points to the delivery tenant,
not the load-test tenant. The audited settings action configured all four
audiences. Campaign `d3352343-d888-42b0-9ba3-f960dd62c688` was created through
the app, its content finalized, and its audience snapshotted. A count-only query
confirmed exactly ten distinct expected Resend test addresses. The campaign
has not been queued or sent. The release's database worker controls remain
disabled. A local invocation reached the protected deployment through the
authenticated Vercel CLI but the app rejected the available local cron
credential. No worker ran. Dispatch and current signed webhook settlement
remain open; Production credentials were not substituted.

Live Development posting passed with fictional data. The composer exposed only
Save as draft and Publish now. Post `159948b2-ce5c-43b6-a650-d2a5e6c6cb3c`
was saved as a draft, then manually published with email unchecked. The database
retains the same post ID, a publication timestamp, no scheduling timestamp, one
`post_created` audit event, and one `post_updated` event. The UI showed the post
in the class stream and explicitly reported that email was not queued. The
deployment status endpoint reported exact SHA
`54c95cf651161dc00d58196eca89962216865a97`, Preview environment, and all four
CSF runtime worker flags false.

GitHub's Development environment has backend and Vercel credentials but no
Development-specific communications worker token. The existing dispatch workflow
uses the Production environment and was not invoked. A proposed Development
test mode has not been implemented or published because its required runtime
credential remains unavailable. Vercel's environment download returns sensitive
values as placeholders, which are not usable credentials. No authentication
protection was weakened and no extra application build was started.

Five current local browser journeys passed in 1.1 minutes on root `fe7b779f`,
whose committed tree matches Development `54c95cf6`. The ignored artifact
`retirement-journeys-54c95cf6/csf-join-review-profile.mp4` is H.264, 1440 by
900, 30 fps, and 58.43 seconds. It covers account-name confirmation surviving
reload, ambiguous pending review, officer rejection, pending-member feed access,
and semester history. The first recording launch refused a local port mismatch;
the recording-only configuration then forwarded the owned port 3014. The runner
reported a shutdown EPERM warning, but no Next server or bootstrap remained in
the subsequent process check. Officer approval, application and point decisions,
attachments, and workbook preparation are not covered by this clip.

Two additional current local recordings passed in 56.9 seconds: application
approval persisted after reload, and point-submission approval persisted after
reload with a recorded reviewer and timestamp. The extended ignored artifact
`retirement-journeys-54c95cf6/csf-member-officer-walkthrough.mp4` contains all
seven journeys, runs 107.53 seconds, and retains 1440-by-900 H.264 video at
30 fps. Connection-request approval, attachments, and workbook preparation
still need recording. This does not close hosted or Production acceptance.

The next isolated run passed directory search by typing, button, Enter, and
clear. Officer connection approval initially stopped at navigation because the
first-login tour covered the workspace. After test setup waited for workspace
hydration and dismissed the tour, the officer workflow passed in 12.3 seconds.
It verified the account link, active organization membership, resolved request,
and removal from the queue after reload. The app code was unchanged for this
retry. The recording is retained under
`retirement-submission-54c95cf6/retry-results`.

The proof-upload check first clicked before hydration, then reached a database
refusal after test setup was corrected. The earlier synthetic point-review
recording had left its verification period open. PostgreSQL refused the new
student claim with `check_violation`; zero synthetic phone claims were saved.
The UI incorrectly treated that known refusal as an uncertain write and showed
Officer follow-up required. A local private-plugin correction maps the exact
database refusal to a submission-lock explanation, while unknown errors retain
their reconciliation behavior. Seven focused tests, targeted lint, and root
TypeScript pass. This correction is not merged or deployed. The successful
attachment journey remains open until the fictional verification period is
closed through the officer workflow and the journey passes.

A new isolated browser regression seeds 52 disposable directory records and
checks that search finds the last record when it is absent from the first page.
Targeted lint passes; its browser execution remains pending. The prior search
control pass alone does not prove beyond-first-page search.

The officer UI subsequently closed the fictional Fall 2026 verification period,
and the mobile proof journey passed: fixed one-point activity selection, PNG
upload, submitted claim visible, and audited withdrawal. A count-only local
query confirms one withdrawn synthetic phone claim and one closed verification
period. The recording is `retirement-submission-54c95cf6/student-proof-upload.mp4`.
This run includes the uncommitted private point-lock error correction, so it is
not exact hosted Development acceptance. Its first beyond-page test failed
during fixture insertion because normalized names were missing. The fixture
was corrected; that failure is not an application search result.

The corrected beyond-page test passed in 3.9 seconds. It seeded 52 fictional
records, verified that the target was absent from the initial directory page,
found it by server search, and verified the result after reload. Its cleanup
removed all 52 owned profiles. The isolated private test orchestrator passed all
266 discovered plugin test files with the point-lock error correction. Browser
runner teardown still reports EPERM; these passes do not resolve that tooling
issue or the failed hosted latency gate. No hosted build, email send, or
Production mutation occurred in this continuation.

P2 local recording tooling: runner shutdown reports kill EPERM and leaves its
port claim behind. Before the second run, PID 75542 was confirmed absent and
port 3014 free; its exact claim was moved aside, not deleted. The second run
passed and again left no app process but reported the same shutdown error.
Do not mistake a stale claim alone for a running app or delete unverified claims.

Read-only Drive metadata checks on 2026-09-07 found all four official file IDs
accessible. Their modification timestamps exactly match Production's stored
provider timestamps. Each registry entry remains linked with eight discovered
tabs and no workbook error. The connector omits Drive's numeric version from its
normalized metadata response, so this proves timestamp agreement, not a fresh
provider-version comparison or repeat commit. No source rows were fetched or
changed during this check. Application reconciliation remains open.

Read-only Production checks found four linked workbooks with eight discovered
tabs each and current preparation snapshots. All 4,434 imported activity entries
have labels, consistent credit links, and valid same-term catalog links. All
1,392 attendance records have labels and valid meeting links. This check did not
re-read Drive or repeat a commit. Applications remain uncommitted: 588 preview
rows include 585 ambiguous rows, two conflicts, and one resolved row. Their source
class and semester grouping remains intact, including alumni. Production has
zero communication campaigns, attempts, and deliveries. These counts do not
close the remaining officer reviews or live acceptance.

## External/account blockers

P2 application preview navigation remains open. Production has saved Spring and
Fall previews, but the Applications import panel renders the latest preview of
the allowed source type. Opening Import responses after selecting Spring still
shows the Fall preview's 71 unresolved rows. Import history lists both runs but
offers Run details, not a resume control. Code confirms that
`findLatestCsfSheetPreviewId` accepts organization and source types only, while
the workspace controller selects the first preview in recent jobs. Add explicit
saved-preview selection with organization/source-type checks. Rows, readiness,
history selection, paging, and commit identity must agree on that selected ID.
Do not make the application review's class or semester filter overwrite a
source row's target, or generate another preview just to make it newest.

The local reader regression reproduced the selection defect before the fix:
requesting an older preview returned the newer one, and an out-of-scope selected
ID silently fell back to another preview. Scoped readers now accept an explicit
preview ID, validate its shape, and retain organization, preview-mode, and
source-type filters. The workspace resolves its row page first and pins readiness
and the meeting commit gate to that ID, so a concurrently created preview cannot
change those reads to a different job. Eleven paging tests and four workspace
selection tests pass. TypeScript, targeted zero-warning lint, and diff checks
pass. This work is uncommitted. URL handling, saved-preview controls, history
selection, recovery wiring, and browser acceptance remain unfinished; the
Production navigation defect is not yet fixed.

The local follow-up now carries `csf_import_preview` through the dashboard URL,
row paging, and source-type permission boundary. Saved previews have direct
navigation links, and source history offers Open preview for older runs. An
explicitly selected run outside the recent ten is fetched with the same
organization, source-type, and preview-mode filters. The workspace's preview
metadata and recovery queue use the resolved row-page job ID. Returning to
application review clears import selection without changing source targets.
Twelve URL tests pass, including cursor reset and selection preservation.
TypeScript, changed-file zero-warning lint, and all 267 discovered private-plugin
test files pass. The changes remain local and uncommitted. Synthetic browser
acceptance, unavailable-preview feedback, and selection after preparing a new
preview still need verification before this issue can close.

The local UI now reports an unavailable selected preview explicitly. Source-save
and preview actions navigate only after a successful response includes a valid
preview UUID. They open that returned ID, including reused snapshots, rather
than assuming the newest job is the result. Failed or incomplete responses do
not change selection. A navigation failure preserves the successful receipt and
offers reload/history instructions. Thirteen URL/result tests, TypeScript,
changed-file zero-warning lint, and diff checks pass. Browser verification of
these paths remains open; no hosted build or data mutation occurred.

The compiled isolated browser test now passes in 4.0 seconds. It opens the older
of two fictional application previews, reads page two of 51 rows, reloads on
that same preview/page, switches to the newer preview without retaining the old
cursor, and opens an unavailable UUID without displaying a fallback import.
All owned fixture jobs and rows were removed afterward. The first attempt
correctly hit the ledger's service-role write restriction before navigation;
fixture setup now uses the validated isolated database, without changing grants.
The second attempt opened the old preview but used a link selector for the
Next rows button. Both failed artifacts remain beside the final passing run in
`.artifacts/csf/preview-selection-*results`. The runner still reports kill EPERM
on teardown, so this pass does not close that separate tooling defect. Hosted
acceptance, successful preparation navigation, and older-than-ten source-history
browser coverage remain open. No Production or provider data was changed.

The expanded compiled browser journey passes in 6.3 seconds. It adds ten newer
fictional jobs, confirms the original preview is absent from the recent list,
opens it through saved-source history, and reloads its 51 rows. Cleanup confirms
zero owned fixture jobs and sources remain. All 267 private-plugin test files,
TypeScript, and changed-file zero-warning lint pass. Private commit
`288ace3fb0b6c483cf849c3a286e537d879467c4` contains saved-preview selection and its
service tests. It follows the local point-lock fix `23086f6`; neither commit is
pushed or merged. The root browser test remains uncommitted with the other
grouped acceptance changes, and the root gitlink stays at `dbc3a79`. Production
still serves the old importer. Successful preparation navigation is covered by
result/URL tests but still lacks a live source-preparation browser run.

A new count-only Production contact comparison inspected the two saved official
application previews. All 588 rows retain application contact fields. None of
the 71 Fall rows match an active same-class profile's stored contact. Of 517
Spring rows, one matches both a stored contact and normalized name; 516 have no
stored same-class contact match. No row matches multiple same-class contacts.
The single contact-and-name row is still ambiguous and pending, has no matched
profile, and has no officer decision. This is separate from the previously
resolved row. These counts identify review work, not verified identity or an
application approval. No source values were retained in this report and no
Production records were changed.

Local follow-up commit `23086f64145afadff22c33c7f057c6a3c73e6d77` in the private
repository records the point-verification refusal fix. Seven focused tests with
38 assertions, targeted zero-warning lint, TypeScript, and the private application
ownership contract pass. The private worktree is clean. This commit has not been
pushed or merged, and the root gitlink remains unchanged until private integration.
Earlier recordings that included the uncommitted fix contain these same two-file
changes, but remain local evidence rather than hosted acceptance.

Disposable detached-child probes under both Node and Bun returned ESRCH after
the child exited, not the browser runner's reported EPERM. The probe therefore
does not reproduce that teardown failure. No process-signaling behavior or port
claim handling was changed on the strength of this negative result.

Production browser recheck: the signed-in officer session opened the chapter-wide
application importer. The selected Fall preview reports 71 rows requiring
reconciliation, with 50 review panels on the current page. Commit remains disabled.
Each panel offers an existing-member match with a reason, an explicit new-profile
decision, or a skip. This is not evidence that all rows are duplicate people or
that the selected class should replace their source class. No reconciliation,
application decision, or import commit was performed in this check.

The current local scheduling checks passed 48 tests with 185 assertions across
the compatibility route, publisher availability, post outcome/refusal contracts,
and forward-migration release safeguards. Legacy scheduling errors map to the
retirement message, including the old database text that suggested creating a
scheduled post. No historical migration was edited. These focused results do
not replace hosted acceptance, live email settlement, or Production migration
and public-release verification. No deployment or provider mutation occurred.

EXT-007: a provider metadata response exposed the shared Vercel automation
bypass query value in tool output. No value was copied into source or retained
reports. Resolved on 2026-09-06: separate replacement tokens now serve the
Development and Production webhook endpoints and CI consumers. Both signed
replays returned HTTP 200 before the old token was revoked. No application
build or email send was required. Controlled ten-message acceptance remains
unproven.

| ID      | Dependency             | Blocker                                                                                                                                                                                                                                                                                                                                                                                                  | Required owner/action                                                                                                                                                                                                                                                                     |
| ------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EXT-001 | GitHub Support         | Cached views and PR #97 refs for the removed raw workbook require server-side dereferencing/garbage collection. The available browser Support account does not include repository owner `riddhimanrana`.                                                                                                                                                                                                 | Repository owner opens Support ticket with affected commit mappings and PR #97                                                                                                                                                                                                            |
| EXT-002 | Google                 | Live OAuth chooser, Picker, Drive import, refresh/reconnect/revocation, 403, and 429 journeys require approved test account/configuration.                                                                                                                                                                                                                                                               | Google account owner authorizes Development-only run                                                                                                                                                                                                                                      |
| EXT-003 | Hosted Development     | **Resolved 2026-08-10.** Persistent Supabase Development branch exists (`ocbuygudvarsuxijxhau`, 218 migrations, advisors clean). `dev.lets-assist.com` is wired to the `development` branch with Valid Configuration. Branch-scoped Vercel Preview variables for the three Supabase keys are present and scoped to `development`. Authenticated preview access and deployment-log access both confirmed. | Closed. Verified in the Vercel dashboard and against the Supabase branch                                                                                                                                                                                                                  |
| EXT-006 | CSF Development access | **Resolved 2026-08-27.** A fresh hosted Development browser check in the named Riddhiman Chrome profile confirmed the account can open the DVHS CSF organization, Class of 2027 through Class of 2030, the member directory and profile, imports, class settings, and the linked-spreadsheet picker.                                                                                                     | No remaining access action. Real-sheet linking and import commits remain separate staff-approved data actions.                                                                                                                                                                            |
| EXT-004 | Production Resend      | **Superseded locally 2026-08-30.** Deployed application code no longer reads a Resend management credential. It accepts only reviewed, non-secret topic IDs from environment-scoped configuration. Production still has its existing member topic and webhook; the new topic bindings and rotated webhook have not been applied.                                                                         | In a separately approved Production release, an operator creates or verifies the provider topics outside application runtime, stores only their IDs in `CSF_RESEND_TOPIC_CONFIGURATION`, rotates the webhook keyring, and proves test-event settlement before disabling the old endpoint. |

## Completed milestones

| Milestone                           | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CSF communications recurrence       | **CLEAN-016 and EXT-005 resolved 2026-08-24.** Production Vercel Pro requests communications dispatch every ten minutes; observed starts can be irregular. The authenticated response reported `enabled: true`, zero campaigns, zero faults, and no delivery outcomes; the durable ledger remained empty. GitHub remains a manual, approval-gated fallback. CLEAN-015 separately tracks the disabled scheduled-post publisher. |
| Root browser harness modularization | The former 3,277-line harness is split by launcher ownership, Docker lifecycle, verifier workflow, and CI contracts; all resulting test modules remain below 1,200 lines.                                                                                                                                                                                                                                                      |
| Test process isolation              | `bun run test` discovers both root and plugin suites, executes every `mock.module` file in its own Bun process, and prevents one plugin test's global mock from deciding another test's result.                                                                                                                                                                                                                                |
| Artifact boundary                   | Generated browser output and formatter caches use ignored `.artifacts/`; the allowlisted cleaner is dry-run by default.                                                                                                                                                                                                                                                                                                        |
| Production dependency audit         | `bun audit --production` reports no vulnerabilities and now runs inside `quality:static`; compatible direct dependencies are current and four major-version holds have explicit peer/runtime evidence.                                                                                                                                                                                                                         |
| Root module extraction              | Oversized root action, report, moderation, seed, and browser-harness code is split behind compatibility exports; maintainability checks, focused tests, and the production build pass.                                                                                                                                                                                                                                         |
| Private CSF module extraction       | The private CSF actions, dashboard assembly, and import-integrity suites are split by domain; 2,337 private tests, root gitlink integration, and the isolated replay pass.                                                                                                                                                                                                                                                     |
| Compiled browser runtime            | Local CSF/DV E2E now uses the same compiled runtime as CI, eliminating the development hot-reload module invalidation failure; CSF passes 40/40 behavioral scenarios and DV passes 3/3.                                                                                                                                                                                                                                        |
| Fictional fixture identity          | CSF admin fixtures no longer reuse a real owner name or portrait; seed reruns synchronize the public profile through authenticated self-update RLS, with regression coverage and reviewed screenshots.                                                                                                                                                                                                                         |
| Isolated teardown                   | Dry-run ownership validation preceded deletion; the exact CSF stack then proved zero residual labeled containers, volumes, or networks and removed its generated work directory and secrets.                                                                                                                                                                                                                                   |
| Fresh-install dependency graph      | The global Ajv override that broke ESLint after a clean Bun install is removed, and the imported Shadcn Tailwind v4 stylesheet is now declared; both resolutions have regression coverage.                                                                                                                                                                                                                                     |

## Production staff account connection, September 9, 2026

- Fixed P1: staff with profile management access can connect a confirmed active organization account to an unclaimed CSF profile when login and contact emails differ. The operation preserves history, contacts, and staff roles, requires a reason, and records an audit entry. Conflicting existing connections are refused.
- Fixed P2: the import review pager stays available when the current page contains only resolved rows.
- Production database validation: 25 functional assertions and four authorization-lock and ACL assertions passed in rollback transactions against the exact 476-migration ledger. Private action and rendering regressions cover the new interface; release evidence follows the exact integrated commit.

## Simpler application imports and review, September 9, 2026

- P1 fix implemented: automatic application refresh waits for every outstanding commit from the same source. When an ancestor settles after a child preview was created, one fresh immutable preview can recover its reviewed matches. The database still validates identity and commit state; frozen rows are never rewritten. A known stale automatic-approval refusal settles its queue as blocked rather than retrying forever; unrecognized failures remain retryable. Ordering, recovery, and scope regressions passed 43 tests.
- P2 fix implemented: the connected Sheet view puts status and student matches first, with configuration and recovery controls under Advanced. Application and point review use the page scrollbar; Up/Down no longer switch students.
- Application review can reopen without resetting decisions, notes, or assignments. Points and club closeout remain terminal. The forward migration is `20260909231613_csf_reopen_application_review`; 87 focused local database checks passed. Production passed 24 rollback assertions and the exact 477-migration catalog check.
- Manual account connection on release `448203bf165984b1b176f249c4303b6db6fdfec6` was verified in the signed-in Production interface. A fictional browser test also connects an account with a different login email, preserves contacts and roles, and refuses a second profile. The corresponding database suite passes 33 assertions. A fresh 477-migration browser run on private `d4e3cdd` passed six scenarios across application review, saved-preview navigation, and account connection, with one previously retired scenario still skipped. Full CI run `34397396284` passed both quality and database replay.
- Remaining identity decisions stay unresolved. No account or profile merge was inferred from an uncertain owner response. Communications and scheduled publishing remain disabled; this work has sent no messages.

Production acceptance on September 9: release `b1f09bf3f8017e06d1d8330b621787fc58c74f40`
serves the public alias. Full CI `34418897505` passed quality and database replay,
including 92 CSF browser scenarios; four previously skipped scenarios remain
skipped. The signed-in Production view confirms simplified Sheet controls,
direct evidence links, and the account connection form. Worker transitions
`34420712651` and `34420772908` verified workbook and import processing enabled
for that release, with communications and scheduled publishing disabled.
The stale queues settled without direct queue edits. A fresh automatic preview
recovered resolved matches, then created six applications and updated 172.
The repeat audit found 178 distinct applications with courses, both evidence
links, and matching profile contact information, with no duplicate applications.
Two conflicting identities remain in review. All 1,117 green historical source
rows map uniquely to completed semesters.

## Application contact persistence, September 9, 2026

- Fixed P2: automatic profile preparation and application commits now fill blank
  contact fields from immutable application evidence after identity resolution.
  Existing values stay unchanged. A contact already held by another profile is
  skipped and audited; no account link or application approval is created. A
  preferred personal contact takes precedence over the response address, which
  stays in the application record. Only an explicit school contact fills the
  school field.
- Production migration `20260910004059_csf_import_application_profile_contacts`
  passed the exact 478-migration catalog check and 32 fictional rollback checks.
  Local validation passed a fresh replay, 66 focused assertions, and 11 scale
  assertions. The acceptance fixtures also passed beside unrelated records with
  matching row numbers and names, leaving that unrelated data unchanged.
- Fixed P2 in the private plugin: Advanced stays collapsed when an ordinary
  partially completed import only awaits identity decisions. Actual recovery
  failures still open it. Private release `82f2751` passed CI `34422241864`;
  its focused rendering tests passed ten scenarios with 58 assertions. The
  platform release receipt records hosted acceptance separately.

## Account ownership and reported contacts, September 9, 2026

- Open P1: migration `20260910004059` captures unverified application addresses
  in canonical identity fields. Existing class-code joins trust those fields,
  allowing an application contact to claim imported history. The earlier contact
  persistence entry does not close this access defect. Workbook and import
  workers are paused. The owner selected independently verified ownership only;
  all other matches require staff review.
- Local fixes in progress separate reported contacts from identity fields and
  enforce that policy across join and member-history reads. No new release has
  been promoted. Production verification remains required.

Read-only incident review after the owner reported the trust-boundary defect:

- The live ledger still ends at `20260910004059`; neither prepared corrective
  migration has been deployed. The service-role join wrapper still delegates
  to the identity base that matches normalized school and personal contacts.
- The two automatically captured profiles still hold normalized personal
  contacts and have no account links. No account link was created after the
  migration timestamp in the fresh audit.
- An earlier contact-import audit records 170 profiles updated, with 91 school
  and 128 personal contact values, explicitly marked unverified. Fixing only
  the two recent captures would therefore leave the broader join defect open.
- There are two existing verified-status links with unknown recorded connection
  basis, both predating the contact backfill. One has a staff-resolution audit;
  the other was created through a class code. Neither finding establishes
  independent ownership from the available audit alone. No links were changed.
- Both worker-disable workflows report success. Pausing imports does not disable
  class-code account claims. The prepared release must not be described as safe
  or complete until join restrictions and read authorization pass review and
  Production verification.
- Automatic safety review stopped all three repair agents with the reason
  “Potentially unintended activity.” Their local work remains saved and
  undeployed. No blocked repair action was retried during this read-only review.

Reviewed remediation candidate, September 9, 2026:

- Private PR 286 merged as `b3e41e1`. Both member loaders now discard history
  unless the connection is verified. Staff see reported application contacts
  separately. All 319 private test files pass.
- Forward migrations `20260910043037`, `20260910043106`, and `20260910045040`
  separate reported contacts, replace contact/name ownership claims, and install
  an exact-account-set operator hold. The hold preserves login and organization
  roles and reopens settled connection requests. Installing it does not apply it.
- A clean isolated replay passed 481 migrations and 7,572 assertions in 270 SQL
  files. Expanded hold coverage passes 14 assertions. All 310 root test files
  pass after correcting obsolete operator instructions. Production-configured
  strict private ancestry, lint, typecheck, and formatting checks pass. Browser
  tests now require email/name-only claims to remain pending after reload;
  the integrated CI browser run remains pending.
- Fresh read-only Production checks still show ledger 478, two legacy links
  needing review, and zero links since migration `20260910004059`. The guarded
  contact cleanup preview identifies two personal fields on two profiles.
- The earlier backfill job contains 172 rows and 170 matched profiles. All
  91 school and 128 personal values recorded by its aggregate audit match the
  immutable source contacts, and no later profile audit was found. The audit
  lacks per-field prior values, so the patch preserves those canonical fields
  rather than assume they were originally empty. The global join restriction
  prevents contact-only claims regardless of cleanup.
- Chrome staff verification reached Officers & access, Assign position, an
  imported profile, and Connect account without changing assignments or links.
  The connection form records independent verification and accepts a different
  login email. Searching organization accounts by name remains a UI follow-up.
  Fall 2026 currently has 159 needs-review and 21 needs-action applications.
  A sampled review displays direct transcript and receipt Drive links.
- Root PR 510 is the release candidate. No Production database or application
  mutation occurred during these checks. The accepted release workflow requires
  exact-tree hosted Development acceptance; permission to run that verification
  is pending because the owner previously requested Production-only work.
  Workbook/import processing and outbound communications remain paused.

Full rollout audit, September 10, 2026, in progress:

- The owner authorized Development verification and Production release. Earlier
  notes that permission is pending are superseded. Existing safety blocks still
  apply; no blocked operation may be rerouted through another tool or agent.
- Fresh source read contains 205 Fall 2026 responses. Production contains 180
  applications with unique source coordinates and correct grade/cohort mapping.
  Rows 21 and 143 remain identity conflicts. Rows 184 through 206 have no current
  application. All 180 retain source-reported totals and both Drive file IDs.
  Course-line comparison matches after ignoring ordering and empty-course labels
  such as N/A. Null operative totals do not mean reported totals are missing.
- Every one of the 1,910 populated historical workbook rows has a saved import
  target and a corresponding semester record. Class of 2030 has no populated
  historical rows. Of 1,120 rows with green identity-cell fills, 1,117 are already
  completed. Class of 2027 S25 rows 69, 130, and 136 have mixed identity-cell fills,
  green requirement cells, and seven activity points, but remain active. These need a
  source-backed completion review before any change. No history was changed.
- Chrome extension verification in the Riddhiman profile shows the officer review
  with direct Drive links and no nested scrolling container. The other Chrome
  profile was signed out; that state was not evidence of broken staff access.
- Private PR 288 adds Copy link and Open join link to Invite students, using the
  existing class-code route. It merged as b34bccd6b00c21cb87788c5e2e4f11e383cd8b8c
  after plugin-quality passed. This is not a Production deployment.
- Expanded the unapplied legacy hold to include old verified_email connections
  without new-profile ownership provenance. Independently verified staff links
  and new self-owned profiles are preserved. All 20 focused SQL assertions pass.
  The prior signup browser test expected contact-only ownership; it now exercises
  a genuinely new student and checks the created profile's ownership provenance.
- Production's latest release worker record remains disabled for imports and
  communications. Three older release records still have import worker flags on;
  the forward migration controller requires all such flags off before execution.
- Local TypeScript and lint passed. A fresh isolated stack replayed the updated
  ledger. The new-student browser journey passed, including direct class-link
  signup, return navigation, new-profile ownership, and account onboarding. All
  62 release-controller and catalog unit checks passed. Root CI, hosted Development
  acceptance, Production correction, scoped ownership holds, and import refresh
  remain incomplete. Generated source comparisons stay in ignored artifacts.

Follow-up verification for the same audit:

- Source-associated historical activities total 9,282 points and match every
  populated source row. The stored total is 9,310 points. The additional 28
  points belong to four older semester records whose source names differ from
  their corrected profile names. Current imports have separate name variants.
  Three reversed-name pairs and one expanded-surname group require staff identity
  review. Preserve their records until that decision; a name similarity alone
  does not authorize a merge or credit removal.
- All 558 explicit historical completion markers are completed. No completed
  source-associated record lacks an explicit completion marker or consistent
  green identity cells. The three mixed-color rows remain review items. One
  repeated workbook row resolves to the same profile and semester; the activity
  comparison still matches. The user's separate historical profile stays apart.
- Root CI on `900f7b4ed0ea3bfb73b1388ce36600a51b244469` passed the complete database
  replay and browser job. Quality failed only obsolete operator-documentation
  assertions for the private pin and regenerated-link labels; those assertions
  and instructions are corrected in this candidate.
- Account search now matches confirmed login emails directly, filters confirmed
  accounts before limiting results, and checks staff manage-profiles permission
  in the database. It exposes no imported history and grants no ownership.
  The focused legacy-hold and search SQL suite passes 29 assertions. Both the
  new-student and different-email staff-connection browser journeys passed.
  A further browser regression checks that cancellation resets verification.
- Five audited disable-only transitions retired stale worker flags on three
  older releases. A fresh Production read confirms zero enabled release records,
  five transition receipts, and the unchanged 478-migration ledger. The current
  application and ownership correction remain undeployed at this checkpoint.
- Existing Fall application contacts still need the corrected reported-contact
  helper after release. A read-only preview finds 180 valid source-row/profile
  bindings. Canonical identity fields and account connections must remain
  unchanged when those reported contacts are populated.

Further audit evidence, September 10, 2026:

- Root candidate `87de0da26c24fd05d7de12c916d1287514568346` passed both full CI jobs in run `34453204690`. PR 510 merged to Development as `6189b75aff8d1916ddbe8ddcac841dbb4d1767d1`. Both commits have tree `b68104d5a9c6bd96eadf7650358342f0524a8c5a`.
- Private PR 290 passed `plugin-quality` in run `34455363478` and merged to main as `fa10ab6eadec30790c0d1010ac7b697263f77632`. The root still pins reviewed private commit `364335c41614b9532a3e0e0298cd5a1ee3cdab18`, which is contained in private main. The root release CI initially failed that containment check before the private promotion. It is rerunning on the same Development SHA after the dependency was merged, without changing the gate.
- Development Vercel deployment `dpl_HnEDKcm1YjXMtEDDfUt2J7bNeyWx` serves the exact Development SHA on `dev.lets-assist.com`. The matching Supabase Preview check succeeded. Hosted acceptance run `34455314877` is separate evidence and must succeed before Production release.
- The expanded identity audit identified 11 possible identity groups. Twenty-six officer notes on 26 profiles cover 23 profiles in those groups and the three mixed-color completion rows. Notes use the existing authorized staff action and preserve all account links, application decisions, activity points, and completion records. No names or source data belong in this public register.
- All 180 current Fall applications have pending officer decisions: 159 have ready submission status and 21 have missing-information submission status. None was approved or rejected by this audit.
- A fresh complete account table audit contains only two connections, both verified with unknown basis. The scoped hold remains prepared for those exact two IDs. The two later contact captures have no intervening profile audit changes or account history, so their source-proven reclassification scope remains intact.
- Live Chrome verification confirms Daniel Wu's Spring 2026 officer completion with zero recorded points, no import-time Joined date, and no historical missing-application warning. The application details expose direct Drive evidence links and use continuous page scrolling. Staff permissions resolve through explicit user-ID positions, independently from profile account connections.
- The audit-owned local stack `lets-assist-csf-browser-audit0910c` was stopped through the repository teardown. It has zero remaining owned containers, volumes, or networks; other worktrees and stacks were preserved.

Pending: exact Development CI completion, hosted acceptance, root PR 511 promotion, Production migration and app release, scoped account holds, reported-contact repair, fresh application sync, repeat-run reconciliation, and live post-release verification.

Exact Development verification completed: CI run `34455342973`, attempt 2, passed both jobs on `6189b75aff8d1916ddbe8ddcac841dbb4d1767d1`. Database results: 270 files and 7,594 assertions passed. Browser results: 92 CSF tests and 3 DV tests passed. Four CSF cases were skipped: three optional screenshot galleries and the retired roster-upload journey, whose replacement checks that the retired entry point stays absent. The read-only release catalog also returned `csf_target_schema_verified=1` on the live Development database. Hosted acceptance and Production operations are still pending.

Returning-account review correction:

- Hosted Development acceptance run `34455314877` passed on `6189b75aff8d1916ddbe8ddcac841dbb4d1767d1`. Root PR 511 remains unmerged because its unresolved review identified a returning-account defect. A revoked old connection was treated as a live conflict even after staff verified the correct profile. The branch policy was not bypassed.
- Forward migration `20260910090800_csf_returning_account_revoked_history.sql` changes only that conflict predicate. Revoked history remains recorded, and pending conflicts still require review. The already applied Development migrations remain unchanged. A 12-assertion fictional SQL regression exercises the actual staff unlink/connect path, first return, retry, regenerated link, revoked rows on the account and profile, and a live pending conflict. Five assertions fail against the prior definition; all 12 pass with the correction.
- Production remains at migration 478 with workers off. The updated candidate needs exact-tree CI and hosted acceptance before Production release. The release catalog retains the prior 481-migration definition and pins the new 482-migration definition separately.

Point evidence review follow-up, September 10, 2026:

- A fictional Chrome extension journey completed proof upload, officer correction, student resubmission with the original proof retained, and approval. The student sees exactly two verified points and no pending points. A local database read confirms one proof, one credit record, and three review-history entries. An activity-only officer could not access point decisions. No real application or point decisions changed.
- P2: the review dialog called an attached but unloaded proof file absent. Private PR 291 adds the authorized proof loader to the dialog and profile shortcut. Four rendered evidence-state regressions, the existing point-action tests, lint, type checking, and the full private-plugin gate pass. The initial independent application build rejected a temporary dependency symlink; a frozen local install and full rerun passed, including all 321 private-plugin test files. Root integration and hosted/Production verification of this display fix remain pending.

Production ownership release and import checkpoint, September 10, 2026:

- Production PR 511 merged as `bd49f7be9618deacba0f543a096b25f81c77df64`, matching accepted Development tree `02ebfacf5b3fc0ca189490027642aabced28688d` at `056c9cdb195007ea184123a894b003022da7c3b2`. CI `34460240999` and hosted acceptance `34460236994` passed. Database replay passed 271 files and 7,606 assertions; the CSF browser run passed 92 tests. Three optional screenshot galleries and the retired upload journey were skipped.
- Forward migration run `34463660844` and app release `34463817150` passed. Production deployment `dpl_HPPPC3L84Xp1FmmdyiQvAt7qRBnM` served that exact main commit. The live 482-migration catalog verified. The two legacy connections were restricted pending review while organization membership, staff positions, and effective permissions stayed unchanged.
- The reviewed contact repair populated reported contacts for all 180 applications in its frozen scope. Its guards verified that canonical identity fields and account connections did not change. The 170 ambiguous earlier backfill values remain preserved and cannot authorize ownership.
- Workbook refresh `34464381500` and import processing `34464475608` were enabled for that release. Communications and scheduled publishing remain disabled. A direct source read returned 207 responses; the later automatic snapshot contains 208, with 191 stored Fall 2026 applications. The latest persisted readiness reports 190 committed rows and 18 identity-review rows, with zero duplicates, errors, or unknown outcomes. The repeat run reused the 190 committed rows. One review row already has an older application, so the count difference is 17. These unresolved identities remain open; they are not account ownership evidence. An older manual preview covers 171 rows and must not be used as the full-source reconciliation result.

Submission and Home usability follow-up:

- New point submissions use the current semester in both the main form and profile shortcut. Neither form offers a semester selector or chooses an older semester when the current one is absent. Existing server authorization rejects a non-current semester.
- Public join-code guidance no longer lists excluded characters. Member and staff copy uses point submission terminology and plain review instructions. Home now offers direct links to the signed-in user's active organizations even when the organization feed has no posts.
- Chrome verified the local Home link appears as Open DVHS CSF and reaches the organization directly. It also verified the point form has no semester picker and the review dialog loads the selected fictional proof. The proof query retains organization and verified-profile restrictions when the selected submission is outside the first queue page.
- All 322 private-plugin test files passed, including selected-proof pagination and authorization regressions. Root lint, type checking, and the complete private-plugin verification command passed before the final feedback-only copy pass. The copy pass passed all private-plugin tests again. Private PRs 294 and 295 are merged in private Development, and root PR 514 remains the integrated release candidate. The roster filter no longer supplies the new-submission semester. These follow-up UI changes are not yet claimed live.

- The current live directory has 361 Class of 2027 profiles, 293 Class of 2028 profiles, 150 Class of 2029 profiles, and 27 Class of 2030 profiles. Archived Classes of 2024, 2025, and 2026 retain 84, 216, and 243 profiles respectively. Chrome confirmed the latest Application Sheet screen displays all 18 identity-review rows and the repeat import reports zero new records.

- The new isolated Home browser regression passed for an organization without posts, its destination, inactive membership exclusion, and non-member exclusion. The full local test command then passed across 310 root and 351 plugin test files. Review found that the shortcut ignored the selected local read-only preview source. The component now follows the Organizations page's source and configured identity selection; five rendered regressions cover local, remote, missing mapping, missing configuration, and read-error behavior. Exact integrated CI and hosted verification of this follow-up remain pending.

- Production review of PR 515 found that the preview source has only an anonymous remote client. An email-to-ID map cannot authorize private remote membership reads. Home now uses authenticated memberships for normal local and live sessions, and offers the public organization directory in anonymous remote preview without querying memberships or using the identity map. No RLS policy or remote credentials changed. Rendered tests enforce that boundary. CI 34471321840 passed 7,606 database assertions and 90 CSF browser tests; its outdated merge-button locators were corrected in PR 514. The release still requires full integrated CI and hosted acceptance after this preview correction.

Production usability release verified, September 10, 2026:

- Root PR 515 deployed Production commit `84087a03c61d9d42f3a2dc796c1454b7caefac1a`, matching accepted Development `8ab9dcd8c7d268a6eadcf25bb34e31fb149f4681` and tree `0391ca64210ceb04391e3ff9d6f29bd7a294cfe8`. The private gitlink is `01a188a61d0b8422935be7278c1ef717a62ada90`, contained in private main. No migrations changed in this UI release; the ownership correction remains at the verified 482-migration catalog.
- Integrated CI `34474704920` passed on attempt 2. The first attempt stopped before database tests because an isolated runner port was occupied. The ordinary failed-job rerun passed 271 database files with 7,606 assertions, three DV browser tests, and 93 CSF browser tests with four expected skips. Quality passed 311 root and 351 private-plugin test files. Hosted acceptance `34474700668` passed with 100 distinct sessions and 9,678 requests on the exact accepted Development commit.
- App release `34478504810` passed staged verification and Production alias promotion. Vercel deployment `dpl_5X2YzZix9GG1EstjvL7Cd5N1eGHP` is Ready for the exact Production commit. Chrome verified the direct Home organization button on lets-assist.com and followed it into CSF. Home shows the shorter empty-project message. A separate local command-line status probe returned HTTP 429; it is not counted as successful acceptance.
- Workbook refresh enable `34479003557` and import processing enable `34479472025` passed for the new release. A direct Production read confirms both enabled, with communications and scheduled publishing disabled.
- The latest source count is 208 responses. The latest 208-row preview reports 190 committed rows and 18 identity-review rows, with zero duplicates, errors, or unknown outcomes. The dashboard has 191 Fall 2026 applications, all with reported contacts and transcript and webstore evidence links. One unresolved source row already has an older application. The only two account connections remain pending with unknown ownership basis. Staff must resolve the identities; this release does not approve applications or connect those accounts.
- Open P2: CSF Home still projects import tasks from the original job summary. Chrome shows 206 imported rows needing attention even though persisted current readiness reports 18. Its unresolved-import list repeats preview and commit records and labels missing summary totals as zero rows. The Application Sheet review queue correctly shows 18. Correct Home to use current persisted readiness for the actual preview, show its snapshot row count, and avoid duplicate preview/commit task entries. This display defect is not fixed by the usability release. Historical identity groups and mixed-color completion rows remain queued for staff as described above.

Sheet sync rollout in progress, September 10, 2026:

- The new candidate uses persisted Home readiness and deduplicates preview/commit entries. It adds disabled-by-default Sheet destinations, stable record bindings, a versioned export ledger, and a staff review queue for Sheet decision proposals. Account ownership never comes from Sheet values.
- Native cell comments are supported by the connected Google account on a private test copy. Chrome confirmed the test thread is attached to cell A1. This does not prove the application's OAuth connection has the same access. The app capability check and copied-workbook journeys remain required.
- The final migration passed a fresh focused replay with 52 assertions and the 55 release-catalog tests. The combined candidate passed lint, type checking, and all 336 private-plugin test files. The full integrated replay passed all 483 migrations, 272 database files, and 7,658 assertions. Root tests caught stale release documentation and an unpinned candidate gitlink. The plugin gate caught a changed published embedded manifest; these release mismatches are being corrected. Hosted and Production acceptance remain pending.
- Two private test workbooks exist. Chrome verified a separate test organization with public member visibility disabled and CSF installed through the normal controls. It contains no student records. The new worker requires its own server-created, recorded copies before binding destinations. Workbook identifiers and actual responses stay out of source control. No live destination enablement or new Production release is claimed.
- The worker now uses fresh database authorization for organization administrators and staff before writes. Test registration rejects existing Sheet activity, and file guards separate copied test destinations from live imports and exports. Applications use a separate, initially empty export tab with stable record IDs. Final independent review and authenticated copied-workbook journeys remain release gates.
- Open P2: complete copied-workbook Chrome journeys, full integrated gates, reviewed migration catalog updates, and Production acceptance. Historical identity-review items stay unresolved until staff decides them. Email delivery and scheduled publishing remain disabled.

- Release review preserves the published embedded 1.1.0 manifest byte-for-byte. Application 1.2.25 uses host server actions and does not gain direct table access. Open P2: publish a separately versioned embedded host inventory for the nine new server-only sync relations. SQL permissions and the exact migration catalog already cover those relations; editing the old manifest would invalidate its published hash.

- Private PR 297 merged into Development after its quality check passed. Subsequent line-review findings remain open before root integration: require sensitive-export authority for every workbook recipient, export into used rows instead of the allocated grid end, and reconcile deleted Google posts. The full private gate passed after restoring the embedded manifest and refreshing the host import inventory. No Production sync release is claimed.

- Private PR 298 fixes recipient export authority, row placement including computed formula results, and deleted reply reconciliation. Root tests passed 312 files, private tests passed 336 files, and focused formula tests passed 13 cases. The staff-note correction passed the full 483-migration replay with 272 files and 7,667 assertions plus all ten negative catalog checks. Browser acceptance is in progress. Application status-event export remains open before release so decision history retains its original author and date.

- Private PR 299 adds native application review-history export with original authors and dates, human-readable Sheet decision inputs, and record-specific discussion permissions. The account connection Review button waits for hydration. Independent review found no new consequential blockers. Private quality passed on `6a4d36f`; private Development now contains the same source at `5b1c4ee` after restoring main ancestry.
- The final schema replay on root `d6738af4` passed 483 migrations, 272 database files, and 7,673 assertions. All ten negative permission and trigger checks rejected the altered catalogs and rolled back. The migration digest is `70ce2faa4b1ed30f3268ab4b7716ebf5813ed03d6aba824a029ef5761ca48564`. Candidate lint and type checking passed, and all 337 private-plugin test files passed. The full browser rerun remains in progress; native application OAuth access and copied-workbook Production journeys are still unverified.

- The integrated local browser rerun passed 93 tests with four expected skips. It exercised the final private source from `6a4d36f`, now contained unchanged in `5b1c4ee`, and root candidate `0da5a5db`. The previously failing account-review journey passed, along with different-email staff linking, point evidence review, application open/close controls, and staff access. These are fictional local tests, not copied-workbook Production acceptance. Root PR 517 is ready for CI and database preview; private promotion PR 300 is awaiting its required checks.

- Root CI on `11c8f793` passed quality, including 312 root and 366 plugin test files and the Production build. The local full root run hit a five-second inventory-test timeout; all six inventory cases passed on the focused rerun. Neither result replaces the pending final release gates.
- Open P1 from PR 517: cohort membership changes do not queue removal from an existing class destination. The correction must version class scope, export a non-personal removal marker only for an existing binding, and suppress stale inbound decisions and comments. Open P1 from the same review: Sheet review authority can become stale while waiting for a row lock. The same pattern also affects other new sync mutations. The correction must use the existing organization staff-access lock before authorization and record locks.
- Fresh provider reads confirm Development and Production both remain at 482 migrations through `20260910090800`; the candidate migration is unapplied. PR 517 is back in draft while these findings are fixed. Its schema preview adds empty sync relations and ledger metadata, not a student-record backfill. Production has zero legacy writeback rows and zero rows incompatible with the new ledger constraint. The separate test workspace now has a verified Google purpose connection. Both original workbooks are owner-only. No new sync destination is enabled.
- The P1 corrections passed independent SQL and transport review. Root `acb25fb2` adds cohort-scope revisions and removal snapshots, locks staff mutations before permission checks, and proves permission revocation with two concurrent database sessions. Its isolated replay passed 483 migrations, 273 database test files, and 7,695 assertions. The accepted catalog passed, and all ten negative permission and trigger probes refused the changes and rolled back. The unapplied migration digest is `c3f656b315ce20beaa53ceb6cd6e0006122c3f08c264a9685796d9f392d30f1d`.
- The 1,000-application fixture passed its ten-minute bound in 358.283 seconds, slower than the previous candidate. A focused local comparison remains pending. Private PR 304 contains the matching worker fix at `ccede1c`: bounded scope reads, immediate scope checks before writes, stale-input suppression, and cleared managed values for removed records. Its 42 focused tests, type checking, and targeted lint passed. Release stays pending until the integrated candidate and copied-workbook journeys pass.
- Both root CI jobs passed on `11c8f793`, including the database and browser job. That result predates the P1 corrections and does not establish final candidate acceptance.

- Worker follow-up: PR 517 identified an additional claim/permission race. Root `add319ca` serializes worker claims and intake with staff access, checks lease expiry against wall-clock time after waits, and validates the record version in the final lease guard. Receipt and reconciliation writes use destination, binding, then ledger lock order. Real concurrent-session tests reproduced six failures before the fix; all 104 focused database assertions passed afterward, plus 55 catalog checks. Independent review found no remaining blocker in this scope. The unapplied migration digest is now `a8e8da4c320c5da8f2d30b0f13c586e97fad4ad70e3f5219a26a863dd6a004a7`.
- Private PR 307 passed CI and merged at `df41078`. Its final Google dispatch guard checks permission and the expected record version after metadata and comment-anchor reads. Rejected checks report blocked without sending a request; uncertain results remain reserved for possible provider writes. Its 67 focused tests, type checking, and lint passed. Private PR 306 also removed repeated Settings descriptions and shortened Google connection and report guidance.
- The local import timing comparison passed both runs: 181.732 seconds with the new cohort trigger enabled and 259.695 seconds with it disabled. This comparison does not support attributing the earlier slowdown to that trigger. The fictional records rolled back, the trigger was restored, and both owned test stacks were removed. Final integrated release checks and copied-workbook Google journeys remain pending.
- Final worker candidate `70fa18c1` passed a fresh isolated replay: 483 migrations, 106 CSF tables, 273 database files, and 7,710 assertions in 277 seconds. The exact catalog and all ten negative permission/trigger probes passed. The owned test stack was removed. Root CI also completed successfully on the earlier `740b60f6`, including 93 CSF browser tests and four expected skips. The latest worker candidate still needs its own integrated CI and hosted acceptance; native application OAuth comment access and copied-workbook journeys remain unverified.

- The September 10, 7:33 PM Pacific read-only reconciliation matched all 1,910 supplied historical rows to persisted source coordinates, identity hashes, profiles, and semester memberships. Coverage was 1,108 Class of 2027 rows, 652 Class of 2028 rows, and 150 Class of 2029 rows. All 1,117 consistently green rows and 558 explicit completion markers remain completed. Three previously identified mixed-color rows remain open for staff review. Class of 2030 has no historical memberships; Classes of 2024 through 2026 remain archived.
- The fresh Fall 2026 source contains 220 responses, compared with 120 in the attached workbook. Production contains 194 applications with distinct source rows, all in Fall 2026 and all with pending officer decisions. Of these, 168 are ready and 26 need information. The latest import refreshed 191 rows and retained 29 identity-review rows. Three review rows already have applications, so 26 source rows have no application yet. Two existing applications retain older course or total values pending identity resolution. All 194 applications retain matching transcript and receipt Drive IDs. All 52 applications from the Fall 2025 source map to Fall 2025. This verifies persisted data, not Drive access or browser rendering.
- Chrome staff navigation separately confirmed all 194 pending Fall 2026 applications across the four class filters: 49 for Class of 2027, 53 for Class of 2028, 64 for Class of 2029, and 28 for Class of 2030. The test workspace still shows its connected Google account. Native comment capability for the new application worker remains untested until that worker is deployed.
- Open P1: source DELETE operations do not consistently queue updated snapshots, and source changes can be lost while a destination's configured staff member temporarily lacks export authority. PR 517 is back in draft. The correction must preserve internal pending work while keeping every actual export permission-checked, and cover all snapshot dependencies, old/new scope changes, and deleted parent records.
- Open P1: a fictional transport experiment sorted two rows during the final dispatch check. The positional write overwrote the other row's managed cells and returned success because it checked only the written row. The next full read detected duplicate IDs. The correction must verify the complete managed ID set after writing and hold uncertain results for reconciliation. This does not make positional Google writes atomic with concurrent sorting. No provider records, application decisions, or points changed in the experiment.
- CI `34554258583` passed both jobs on `3eab2a09`, including 273 database files with 7,710 assertions, three DV browser tests, and 92 CSF browser tests with four skips. This result predates the source-deletion, permission-suspension, and positional-write follow-up corrections. Those changes still require a fresh integrated run before release.
- Root `ac46d11f` integrates the reviewed source-queue correction. All snapshot sources now handle deletions and old/new associations, and an owner-only helper retains pending exports during staff access suspension. Real concurrent sessions reproduced a foreign-key lock deadlock; destination `FOR NO KEY UPDATE` locks remove that conflict while retaining lease serialization. Reconciliation requires disabled syncing and no active export attempts. The focused suite passed 128 database assertions and 55 catalog tests. The unapplied migration digest is `cf0c10d5a3e49ae9353e2508097e3086d02b145e650803922061d1b0c55b6bf9`. Final integrated replay remains pending.
- Private PR 310 passed its full quality job and merged as `9edb9101`. Class Settings uses a shorter spreadsheet description and places imported-profile consolidation under Advanced. This change is not yet deployed.
- Private PR 311 passed its full quality check and merged as `52bceb2`. Complete managed-row verification now holds displaced or missing IDs rather than reporting a successful export. Staff can inspect held exports under Advanced and request a checked retry with a reason. The server requires private access, intact row identities, and matching native comment receipts. Missing receipts stay held for operator repair. Positional Google writes remain non-atomic with concurrent sorting. The focused patch passed 69 tests with 298 assertions, lint, type checking, and independent review. No copied-workbook Production journey has passed yet.
- Exact integrated candidate `38b29693`, with private `52bceb2`, passed a fresh isolated replay of 483 migrations and 106 CSF tables. All 273 database files and 7,734 assertions passed in 117 seconds. The accepted catalog passed, and all ten permission/trigger drift probes refused the changes and rolled back. Root TypeScript checking and 40 documentation checks also passed. The owned test stack was removed and the source tree remained clean. Integrated CI, hosted acceptance, and copied-workbook Production verification remain pending.
- Open P1: class and point exports omit policy changes from their source version and refresh triggers. The class worker also omits attendance from completion evaluation. The correction must version every projected policy, attendance, credit, evidence, and profile-name input, use the existing policy mapper and completion rules, and refresh affected destinations after source changes. Application and point labels also need refresh after profile renames. PR 517 remains in draft until these dependencies are fixed and reviewed.
- CI `34556589443` stopped before database replay because port 55322 was already in use. The candidate moves the CI-only isolated bundle to base 25320, below the usual Linux ephemeral range, while preserving the same ownership and occupied-port checks. Local launcher defaults are unchanged. All 36 CI topology contract tests passed; the next hosted runner must verify startup. This environment failure does not invalidate the separate local 7,734-assertion result or establish CI database acceptance.

- Root `87548e23` passed the SQL replay for the versioned Sheet projection and inbound lease correction: 483 migrations, 106 CSF tables, 273 files, and 7,751 assertions. The accepted catalog and all ten negative permission/trigger probes passed. The migration digest is `09ab3e97b3383e4526b55f2e3c10ea523e52c128d0a92e26dcdb6d749c887775`. The owned stack was removed. This is SQL evidence only; final private integration and hosted acceptance remain pending.
- Private PR 314 contains reviewed projection consumption, inbound lease forwarding, class QR sharing, verified application status, pending-record privacy, and removal of the misleading application unlock control. Root Home now distinguishes organization tools from platform projects. The latest integrated Home and documentation checks passed 50 tests with 660 assertions. Full private CI and Chrome journeys remain pending.

- Private PR 316 passed full CI `34559286156` and merged as `9e6076e`. Candidate connection responses now require staff verification or exact self-owned provenance, and pending status requires a saved review request. Root `df579dd0` preserves class links through password fallback and expired verification recovery. Independent reviews passed; 17 private ownership tests and 86 focused authentication tests passed.
- The local root runner stopped on two five-second infrastructure test timeouts during concurrent Docker/browser work. Both passed unchanged when rerun individually; this does not establish a complete root test run. The three new authentication test files passed with the standard preload. Integrated CI remains required.
- Local Chrome verified the Home organization shortcut and class invitation QR on root `24eb9e4f` with private `07930d2`. The QR decoded to the exact visible class link. Member/correction screenshots remain unverified after local browser timeouts. These are fictional local checks, not hosted or Production acceptance.

- Integrated CI `34559594894` reached database tests but its quality job stopped on formatting in nine UI/test files. The repository formatter corrected those files without behavior changes. Private promotion PR 315 passed CI and merged as `1194f80`; its ancestry return is PR 317. Root CI must pass on the formatted candidate before release.

- Open candidate P1: PR 517 review found that a class Sheet destination could omit its cohort and select organization-wide profiles. The unapplied migration must reject that configuration and enforce a table constraint. Open P2: add indexes for profile and record binding lookups used by row triggers. No new sync destination exists in Production before this migration. The standalone confirmation test now mocks the server-only marker; it already passed under the canonical preloaded CI runner.

- The class-destination P1 and binding-index P2 are fixed in reviewed root `671c671f`. Class exports require a cohort in both the configuration function and table constraint. Organization-scoped profile and record indexes cover trigger lookups. The affected tables are new in unapplied migration 483, so this patch changes no existing student rows. The focused database suite passed 149 assertions and the catalog suite passed 55 checks. The new migration digest is `1b7116f4b370db50230b2f9ecdd4fd4357c4da404570d529d1dfc49dab7537d1`; full replay remains pending.
- A fresh read-only Production reconciliation at 8:52 PM Pacific accounts for all 221 source responses: 195 distinct Fall 2026 applications and 26 unresolved rows without an application. Of the applications, 169 are ready and 26 need information; every officer decision remains pending. The class counts are 49, 53, 65, and 28 for Classes of 2027 through 2030. The latest 29-row identity queue includes three rows with existing applications. The two legacy connections remain restricted pending staff review, and no verified connection lacks accepted ownership provenance.
- Root `08e2c0bd` removes the technical plugin description from account visibility settings. Names, organization attribution, and visibility controls remain. The integrated formatter and 19 migration/catalog tests passed on `671c671f`. CI quality passed on the preceding `eaf414eb`; its browser job and the final candidate's integrated checks remain required.

- Open candidate P1: PR 517 found that workbook-local replies enter the record-wide snapshot for other destinations bound to the same record. Independent transport review confirms the existing worker filters by binding ID, so no cross-destination provider disclosure was demonstrated. Narrow the snapshot to its destination and test two workbooks with separate discussions. Open P2: thread-binding retries currently compare only the thread ID and can replace a different post/version receipt. Preserve the exact stored receipt and reject conflicting retries. PR 517 is in draft again; migration 483 and the new sync release remain unapplied.

- The destination snapshot and receipt findings are fixed in root `7a88f763` with private PR 318, merged as `d9e9b3e`. Local replies affect only their binding and destination revision. Exact receipt retries are idempotent; intentional edits require the previous stored version and unchanged provider IDs. Conflicts remain held after an uncertain provider write. Private CI `34562331825` passed.
- SQL root `43ccc57a` passed a fresh replay of 483 migrations, 106 CSF tables, 273 files, and 7,766 assertions in 99 seconds. The accepted catalog returned one, and all ten permission/trigger probes refused altered catalogs and rolled back. The migration digest is `906c4b4d55360adabd306906b973e5bf76160f438087cf87ba3fac7130d7af42`. The owned stack was removed. Public actions are unchanged; the service-only receipt function accepts an optional expected prior version.
- Fictional Chrome login and member Home were verified on root `69449173` and private `9e6076`. Opening the organization timed out again, so member application, point, and profileless-staff screenshots remain unverified. The ignored guide records those gaps. The owned tab, server, and stack were removed, with other worktrees and stacks preserved.

- CI `34561369707` passed both jobs on root `69449173`, including its full browser suite. This result covers the Home, joining, ownership, and class-scope candidate before the final comment receipt/snapshot correction. That correction passed its separate SQL and private gates and still requires final integrated CI.

- Open candidate P2: class destinations validate organization ownership of the class and semester separately, without requiring the configured cohort-term pair. Open candidate P2: export completion compares lease expiry with transaction-start time after waiting for locks. Related comment and receipt paths also need expiry checks after their row-lock waits. These findings affect the unapplied sync migration; PR 517 is in draft while the corrections and lock-wait regressions are completed.

- Root `197bcb02` closes the configured class/semester and lock-wait expiry findings. Class exports require the configured pair; removed pairs expose no new data and do not block bound or unbound source edits. Export completion and comment/receipt mutations recheck expiry after waiting for locks. Exact recorded retries remain idempotent. Independent review passed with no private caller change.
- SQL root `8c4c9a6c` passed 176 focused assertions, 55 catalog checks, and a fresh full replay: 483 migrations, 106 CSF tables, 273 files, and 7,782 assertions in 162 seconds. The accepted catalog returned one; all ten negative permission/trigger probes refused the changes and rolled back. Migration digest: `f0b7e294094376890352ef6e6bae83c199646f24864b9257ef102d0cfb7292f2`. The owned stack was removed. Integrated formatting and 53 documentation/catalog tests also passed.
- Private promotion PR 319 passed CI `34562606616` and merged as `b434a5a`. Return PR 320 passed CI `34562831190` and merged as `548cc0c`. Both branches contain the exact release source, which matches the root's reviewed `d9e9b3e` gitlink. The 1.2.25 tag remains unpublished until root migration 483 is merged.

- CI `34562972641` passed both jobs on root `17b3031d`, including the full database and browser job. This verifies the destination-discussion and receipt-CAS integration before the final class-pair/lease-wait correction. Chrome also opened the restricted Production test workspace and navigated to Settings; this confirms navigation, not native comment access or new-version acceptance.

- A fresh read-only reconciliation at 10:18 PM Pacific accounts for 227 source rows: 196 Fall 2026 applications and 31 rows without an application, all awaiting identity review. Three other review rows already have applications. No Fall 2026 application has a recorded officer review. Production remains at 482 migrations.
- Open candidate P1: managed export ledger payloads can be updated independently of their source version through the existing service-role table grant. The worker already compares the payload with a fresh snapshot and rejects mismatches, so no forged provider export was demonstrated. Add database immutability for managed export identity, version, and payload while preserving legacy writeback and lease/status changes. PR 517 is in draft; the new sync migration remains unapplied.
- Private PR 321 passed CI `34565096350` and merged as `a7eb1b96`. Help now describes assigning staff access to an active organization account without requiring a student class. The unpublished 1.2.25 version is unchanged. The ignored DOCX and PDF guide contains three fictional screenshots and marks the remaining hosted journeys as unverified.
- The help-only promotion PR 322 passed CI `34565408165` and merged as `c152f567`. Return PR 323 passed CI `34565688686` and merged as `db689628`. The unpublished application tag target is `c152f567`; the root serving gitlink remains `d9e9b3e`. Application publication records the signed source separately and preserves the serving gitlink.
- Root `cada3b9b` closes the managed ledger mutation finding. Service-role access is read-only; reviewed database functions retain writes. A trigger freezes managed export identity and payload, a constraint binds the payload hash, and claims compare the queued payload with a fresh snapshot. Legacy writeback and checked retry transitions remain covered. Independent review, 186 focused database assertions, 55 catalog checks, and 34 integrated release-contract tests passed. Full replay is in progress.
- CI `34564524919` passed on `f584ec6a`: 273 database files with 7,782 assertions, three DV browser tests, and 93 CSF browser tests with four expected skips. This covers the class/semester and lock-wait correction before the new ledger immutability patch. The latter still requires its integrated run.
- CI `34566144878` passed both jobs on `924243de`, covering the ledger immutability correction. A subsequent review found that restoring a removed class/semester pair did not queue fresh exports. Root `810aa98a` adds that missing source trigger, including prior bindings and disabled recovery. Root `a3bb8255` also restricts the eight new sync tables to service-role reads; reviewed database functions retain mutations. Existing historical sync-log writes are unchanged.
- Final SQL root `39216bba` passed 196 focused assertions, 55 catalog tests, and a fresh full replay of 483 migrations, 106 CSF tables, 273 files, and 7,802 assertions in 100 seconds. The accepted catalog returned one, and all ten negative probes refused the altered catalogs and rolled back. The migration digest is `addb4359a2cdd0e56b6ba29486840df66f11cc359e080cf53bf8a5fd32eff693`. Independent review passed; all owned test resources were removed.
- Private PR 324 passed CI `34567119689` and merged as `9cee450`. Organization administrators can reach ordinary membership invitations from Officers & access. Root `253d7919` adds Copy invitation link to the existing protected settings control. The existing input provides the hash target; a duplicate card ID was removed during integration. Joining grants ordinary organization membership, without a CSF position or history connection. The combined root candidate pins `9cee450`; publication and hosted verification remain pending.

- Open candidate P1: PR 517 review found that test-copy request foreign keys can block deletion of the isolated workspace or source organization. Related new sync child dependencies also need deletion coverage. The correction must retain the existing authorized organization deletion path and avoid deleting another organization or its business records.
- Open candidate P2: an unknown test-copy outcome has no explicit no-write recovery action. Recovery must require an authorized staff decision with provider evidence, retain the audit trail, and fence late receipts with a new attempt identity. Unknown outcomes must never trigger an automatic duplicate copy.
- Class of 2028 export setup requires unlinking its current class-workbook import connection before enabling F26 export. Disabling only the F26 source is insufficient because parent refresh can rediscover and expand it. The normal Classes, Class of 2028, Settings, class spreadsheet, Unlink action stops parent refresh and disables its sources while preserving imported history and physical tabs. Do not relink that same workbook as an import source while exports are enabled. No live connection changed during this read-only audit.
- CI `34567566933` passed quality, database replay, and DV browser checks on `66be813b`, then failed the three CSF admin accessibility journeys. The new invitation card called a client-exported styling function during server rendering, so the staff route failed before its heading appeared. Six CSF tests passed and 88 did not run. The correction must use the existing server-safe styling module and retain the browser assertions.
- Root `dab21e95` corrects ordinary organization invitation reentry. An account that is already an active member now reaches the invited organization, while other errors remain errors. Two focused tests passed. This changes navigation only and grants no additional permissions.
- Separate existing P2: the organization auto-join removal trigger in `20260712013200_respect_organization_autojoin_removals.sql` can raise foreign-key error `23503` during organization deletion. It tries to insert a suppression after the organization has been deleted. This predates Sheet sync. The new dependency tests isolate it with fictional memberships removed first; they do not establish that the normal organization deletion journey passes. Existing CSF audit-retention restrictions remain intentional and unchanged. No live organization deletion is part of this release.
- Root `8afe754c`, from reviewed SQL `e335eaeb`, removes new sync dependency blockers from otherwise-permitted organization deletion and adds explicit no-file copy reconciliation. Old request IDs remain closed, late receipts are refused, and a new copy requires a fresh ID. Claimed attempts require a ten-minute minimum plus independent evidence that the provider request ended; age or an empty Drive search alone never permits recovery. The complete replay passed 483 migrations, 106 CSF tables, 274 test files, and 7,821 assertions in 100 seconds. The accepted catalog returned one and all ten negative probes refused drift and rolled back. Catalog scope is 28 functions, nine relations, and 26 triggers. The migration digest is `874986c27150405145568a15cc7e90e26fd607b2d77f0a9c6ee1ed1662727cc3`. Owned test resources were removed. Integrated CI and hosted verification remain pending.
- Private PR 327 passed full CI `34569406061` on `522cb3dd` and merged as `c6c93b7`. It adds explicit copy recovery under Advanced, clarifies joining without a prior record, and uses the server-safe invitation styling module. The first private run stopped on filenames containing the word copy; the files were renamed without changing the global source-layout guard. Root now pins `c6c93b7`. No application tag, hosted migration, or Production deployment has run for this candidate.
- Root `23c46541` registers the existing server-safe button styling module in the generated host import contract. The module already exists on root main. The boundary check now passes without weakening its rules. The preceding `156096f4` quality job stopped on that missing contract entry; its database job was superseded by the corrected candidate.
- Open candidate P1: private promotion PR 328 review found that copy recovery could search a newly connected Google account instead of the original copy account. An empty search is then misleading even with staff inspection. The copy request must retain the original provider subject, and recovery must compare the current token subject before searching. Missing or mismatched identity must remain held. Normal promotion was refused by branch policy with this review unresolved; no administrator bypass, tag, publication, or Production mutation followed.
- The 11:25 PM Pacific read-only Production reconciliation accounts for 232 Fall 2026 source rows: 199 distinct applications and 33 unresolved rows without applications. Three other review rows retain an existing application, for 36 review rows in total. No source coordinate has duplicate applications, and no officer decision has been recorded. The two legacy account connections remain pending with unknown ownership evidence. This checkpoint uses completed preview `1b5240bd-8d91-4d89-9332-82843cc0a1ba`; new responses may change these counts.
- Root `73fe040b`, from reviewed SQL `4c375f0b`, pins the original Google subject on copy requests and checks it again during recovery. Missing or changed provenance remains held. Private PR 329 passed full CI `34570548890` and merged as `05e0202`; its caller reads the subject from the same token used for the Drive operation. The full schema replay passed 483 migrations, 106 CSF tables, 274 files, and 7,827 assertions in 106 seconds. The accepted catalog and all ten negative probes passed, with 28 functions, nine relations, and 26 triggers. Migration digest: `00940c788b2702b99f5fbf57314cab57f171d2cb0864e3eda6e7d636258bfafe`. Owned resources were removed.
- The preceding root CI quality job stopped on two guide-label contracts after the joining text changed to Join your class and Continue. The guide and its contracts now match those controls. A separate read-only review confirmed the amended ownership instructions match current actions and SQL. All 21 guide-contract tests passed. Stale email-only ownership instructions were corrected, and historical Amendment 7 is explicitly superseded. Integrated root CI and hosted checks remain pending for the new candidate.

- Private promotion PR 328 passed CI `34570830052` after the original-Google-account correction and merged as `1ce051d`. Return PR 330 passed CI `34571126274` and merged as `424d766`; the unsigned application tag target is `1ce051d`. Root CI `34570882905` stopped its quality job on one stale Class of 2030 documentation contract. The guide now distinguishes approved automatic imports from the manual unresolved-row fallback and keeps reported contacts out of identity fields. All 40 documentation contracts passed, followed by the complete local test suite across 317 root and 377 private-plugin test files. Hosted checks and publication remain pending.

- Root `e3eda023` requires a fresh active organization membership before returning an invitation destination. Pending, inactive, missing, and failed membership reads return a clear error without a destination or status change. Four focused integrated tests passed. A bounded read-only review found no additional code blocker in class continuation, pending-history protection, different-email staff connections, or staff authorization without a student class. This is source evidence, not hosted acceptance. The product contract and operator guide now remove the remaining superseded email-only connection wording and match the current pending-status and signed-out entry labels; all 40 documentation contracts passed.

- Root `1fd84e4b`, from independently reviewed SQL `709b8890`, closes the null reconciliation, test registration audit, and retained actor deletion findings. The full replay passed 483 migrations, 106 CSF tables, 274 files, and 7,839 assertions in 108 seconds. All 195 focused assertions, 55 catalog tests, and ten negative probes passed. Catalog scope remains 28 functions, nine relations, and 26 triggers. Draft migration SHA256: `2b8b62d0bbfea1aef45e08924afe8ff1c04aac9c369ce9a4e31b3b61f1901727`. Owned resources were removed. CI quality stopped on Markdown table formatting in the updated product contract; formatting was corrected without behavior changes. The migration remains unapplied in Production.

- Open candidate P1: live destination enablement checks privacy and native comment access but does not enforce a persisted copied-workbook acceptance decision. Add a reviewed receipt bound to the source organization and actual test destinations, with server-checked sync evidence. Test-copy creation alone is insufficient. Live exports remain disabled pending this correction and the real copied-workbook journey.
- Open candidate sync consistency findings: a stale proposal can suppress the same requested cells after the source version changes; class snapshots include unrelated semester records; and an unknown copy receipt can be completed with a different observed file ID. These need bounded regression coverage before release. Production remains unchanged.

- Root `c09d2086`, from SQL `436da228`, closes the four sync findings. Live enabling requires an audited acceptance receipt bound to the live configuration, tested copies, and current stored export, review, and native-message evidence. The private caller independently reads the managed cells and native posts before recording acceptance. Stale requests can requeue once per new source version; class snapshots exclude unrelated semesters; conflicting observed copy IDs are rejected. Both independent reviews passed. Full replay passed 483 migrations, 107 CSF tables, 274 files, and 7,852 assertions in 110 seconds. All 177 focused assertions, 55 catalog tests, and ten negative probes passed. Catalog scope is 29 functions, ten relations, and 26 triggers. Draft migration SHA256: `53f1bcce1e2adff42b80ef165b8ed2c440232ea7b5160549d1efdff596a078ff`. Owned resources were removed.
- CI `34572462399` passed quality and build. Its browser job passed 79 CSF journeys, then stopped after three stale selector failures for the renamed joining controls. The root tests now use Join your class and Continue, preserving the identity assertions and checking that signed-out visitors have no student-details dialog. Targeted lint passed; the full corrected browser run remains required. No new Production migration or release has occurred.

- Private PR 331 passed CI `34574352776` on `9a6e962` and merged as `521a68a`. Its Advanced control loads stored test receipts and verifies current managed rows, native posts, and file access before the reviewed database acceptance action. Root now pins `521a68a`. Both independent reviews passed. The application version remains the unpublished 1.2.25; no tag or Production activation has run.

- Root `503206f1`, from independently reviewed SQL `d043dfd0`, permits test copies of a same-organization configured live output workbook as well as a registered import source. Unknown file IDs remain rejected. Full replay passed 483 migrations, 107 CSF tables, 274 files, and 7,854 assertions in 163 seconds. All 210 focused assertions, 55 catalog tests, and ten negative probes passed. Catalog scope remains 29 functions, ten relations, and 26 triggers. Draft migration SHA256: `9070babb106ca996b3b8771611d8a73f452b6d9da9ad9cfdfa3c4c9348d8c024`. Owned test resources were removed. The migration remains unapplied in Production.
- Four printable class join cards and a link list were generated from the active Production codes without rotating them. Each QR decoded to its exact class URL. The files remain in ignored artifacts; signup and signed-out browser journeys are still unverified. Chrome confirmed that the restricted Production test workspace has the chapter Google account connected. This does not establish native comment access or copied-workbook acceptance.
- Private promotion PR 332 remains pending after review found ambiguous test-destination selection and an output-only workbook copy failure. PR 333 fixes those paths. A subsequent review found that mixed-kind output workbooks can select an arbitrary Google capability; that correction remains in progress. No administrator bypass or Production release followed the branch-policy refusal.

- Private PR 333 passed CI `34576245635` on `abebcea` and merged as `63eabab`. Staff select one application, point-submission, and class test destination for acceptance. Output-only workbooks can enter the copy flow, and mixed-purpose workbooks use an available authorized connection without arbitrary UUID selection. Both independent reviews passed. Root pins this exact merge. Production remains at 482 migrations with 199 Fall 2026 applications and zero officer reviews in the 12:48 AM Pacific read-only check.

- Private promotion PR 332 passed CI `34576525388` and merged as `5572841`. Return PR 334 passed CI `34576816501` and merged as `783adff`. The root gitlink and promoted source trees match. The 1.2.25 tag remains unpublished pending root release checks.
- Open candidate P1: live destination configuration checks other sync destinations but not every other-organization relation that can register the same workbook. Reject conflicting file ownership under the existing file lock before exporting. Open P2: deleting a test workspace can remove an acceptance receipt without disabling its live destination. Preserve acceptance or disable the dependent destination atomically. Both affect unapplied migration 483. Production remains unchanged, and release is held for correction and regression coverage.

- CI `34576597425` passed both jobs on root `848bd935`: quality and build, 7,854 database assertions, 93 CSF browser journeys, and three DV browser journeys. Four CSF tests were intentionally skipped: the external workbook import and three optional screenshot-gallery tests. This establishes the integrated onboarding and UI candidate before the two later workbook-isolation and acceptance-retention corrections. Those corrections remain release-pending until their catalog and exact-candidate checks pass.

- Root `8127cb7c` and `d6004400`, from reviewed SQL `1ce182a8` and catalog correction `216c9bd5`, close the workbook-isolation and acceptance-retention findings. Live configuration and reverse registration share the file lock and cover nine operational workbook-ID relations. Accepted evidence retains the original test-workspace UUID after fixture deletion; re-enabling still requires a valid test setup. All 224 focused assertions passed. The full SQL run passed 7,868 assertions, then the catalog detected changed trigger fingerprints on two older tables. Version-scoped overrides now preserve the 482 fingerprints and accept the 483 catalog. The final exact replay passed 483 migrations, 107 CSF tables, 274 files, and 7,868 assertions in 161 seconds. The accepted catalog and all ten negative probes passed; owned stacks were removed. Integrated CI remains pending. Catalog scope is 30 functions, ten relations, and 29 triggers. Draft migration SHA256: `bd4c6ad566c17099f70c4b464d08349554351bd80974775de20c8aea428a528b`.
- Chrome inspected the live application queue, a course/evidence detail, staff assignment, class invitation, and class stream without changing decisions, access, posts, or codes. The queue now shows 200 applications. Staff assignment accepts an active organization account without a CSF profile. The class invitation already offers a link and code. Sanitized screenshots remain in ignored guide artifacts. Full copied-workbook sync and student sign-in acceptance are still pending.

- the copied-test scope finding is fixed in root `615402fc`, from independently reviewed SQL `6ebb54a3`. acceptance now checks headers, start column, graduation year, semester, and school year while retaining independent test ids. it archives the mapping and rechecks it on enable. exact replay passed 483 migrations, 107 csf tables, 274 files, and 7,874 assertions. the accepted catalog and all ten negative probes passed. owned stacks were removed. draft migration sha256: `11e4b5ec268fc16782c15be16f694a2ff3c255745cbdd3e30477bb9d4d8ffb5c`. integrated release checks remain pending; production is unchanged.
- A private native Google Doc guide is complete with lowercase prose, seven screenshots, and four active class QR cards. Its 13-page native PDF, permissions, images, and application-points clarification were checked. Screenshots distinguish Production from fictional test views. The guide marks unreleased sync and incomplete hosted outcomes, and explains that the post editor's email checkbox must be turned off for an in-app-only post. No sharing, email, or chapter publication occurred.

- the 1:46 am pacific read-only production audit accounts for all 234 rows in the latest completed fall 2026 snapshot: 200 pending applications, 34 rows without applications, and zero duplicate application coordinates. 37 rows need identity review, including three with applications: 35 ambiguous matches and two duplicate conflicts. all have valid class/semester targets; none established a safe automatic identity resolution. all 1,910 historical source coordinates still resolve to profiles and semester records. the three mixed-color completion cases remain for staff review. the earlier hash/color audit is the value-comparison baseline; this check did not reparse the workbooks.
- root `fed0aef7`, from independently reviewed sql `895fd243`, rejects incomplete native thread receipts before binding or acceptance. semester-specific mutations now restrict revision bumps and queued exports to the affected term; global profile changes retain their broader scope. the private caller already validates native results, so no private change was needed. focused coverage passed 209 assertions and 41 catalog tests. full replay passed 483 migrations, 107 csf tables, 274 files, and 7,884 assertions in 102 seconds. the accepted catalog and all ten negative probes passed. owned test stacks were removed. integrated ci remains pending. draft migration sha256: `43b358ebdd3fa4548a90fb92e165c51f6ddbe0a08404dffca0339dbe301dad4f`. production remains unchanged.

- the fresh historical workbook reparse matches all 1,910 populated rows to saved source coordinates and identity hashes, with profiles and correct-semester memberships. all 1,117 consistently green rows and 558 explicit completion markers remain completed. two current profile-name differences are explained by approved merge snapshots preserving the original identities. zero unexplained identity differences remain. the three mixed-color cases stay active for staff review; class of 2030 has no historical rows. count and coordinate evidence remains in ignored artifacts. no production writes occurred.
- root `b3196377` and `ca708917`, from independently reviewed sql `d73dcfd5` and `653768af`, permit currently authorized successors to reconcile abandoned copies using original google-account evidence, without changing normal claim/finish ownership. export attempts now retain immutable outcome/version receipts and reject conflicting retries; successful exports require a nonempty version. the full exact replay passed 483 migrations, 107 csf tables, 274 files, and 7,893 assertions in 104 seconds. the accepted catalog and all ten negative probes passed, and owned test stacks were removed. draft migration sha256: `e945fa809141ad516e0725d824586d3a720fca39d3a50f7b3cac9fb382876ece`. the private recovery loader correction and integrated release checks remain pending.
- review of deleted-test acceptance confirmed the existing policy: acceptance remains as audit evidence and an enabled destination continues, but fresh enabling requires a current verifiable test configuration. deleting test fixtures requires a new acceptance before re-enabling. the gate and its regression remain unchanged.
- integrated ci `34582581001` passed both jobs on root `71d82428`: quality/build, 7,884 database assertions, 93 csf browser journeys, and three shared dv journeys. four optional csf tests were skipped. this precedes the successor-recovery and immutable export-receipt corrections; final integrated checks remain required.
- private pr 335 passed ci `34584737617` on `969aa474` and merged as `ed1a96b2`. recovery listing now pages past inaccessible sources, preserves source/target authorization, and lets authorized successors inspect eligible requests. source and action tests, ui checks, typecheck, lint, and independent review passed. root pins the exact private merge; production remains at 482 migrations and application 1.2.24.
- private pr 337 passed ci `34585740976` on `a5317caf` and merged as `f03e5a06`. the recovery loader rechecks every returned source after pagination, removes revoked access, then rechecks the target. fourteen focused tests and independent review passed. root pins this exact correction; migration 483 and its 7,893-assertion replay are unchanged. final integrated checks and production deployment remain pending.

- Root `d7d78151`, from independently reviewed SQL `9b64aa56`, requires a provider version for confirmed-write recovery and retains the prior ledger and reconciliation evidence in the audit. Cohort membership changes update only affected cohort destinations. Full replay passed 483 migrations, 107 CSF tables, 274 files, and 7,899 assertions. The accepted catalog and all ten negative probes passed; owned stacks were removed. Migration SHA256: `7c5d9bf9fe47d17ee27f2bf0a862492218d5f9b0eaa98a7b83f185ad97ffb89d`. Integrated release checks remain pending. Production is unchanged.
- Private promotion PR 336 passed CI `34586102695` and merged as `fa78eeb753ab0af537490fc2b0b62e7b3bf67a3e`. Return PR 338 passed CI `34586446612` and merged as `ae6b7c49178da626a805b90bfcc00ffe8972f974`. The promoted source matches the reviewed root gitlink `f03e5a06`. Application 1.2.25 remains unpublished until root migration 483 merges.

### September 11 release follow-up: queue reads and capacity

Root `2560ae7213aa0cee2b207986016a8477612f6e02` passed quality run
`34593409227`, including 7,907 database assertions and 93 CSF browser tests.
Hosted acceptance `34593404576` failed with 177 timeouts in 9,161 requests
from 100 distinct concurrent sessions. Read p95 was 5,686.73 ms. This is not
Production acceptance. Production promotion PR 519 remains open.

The Development Supabase dashboard showed Micro compute, CPU pressure and
swap during the failed run. Provider-side API logs independently recorded
responses above five seconds. A Small compute change is proposed for a
controlled repeat on the same candidate, but recurring-cost approval remains
pending. No compute or billing change has been made.

The same run recorded 308 HTTP 400 responses each for application courses,
application files and credit records. The review workspace sends unbounded
ID filters and discards these query errors. A page can therefore return HTTP
200 while missing review data. The exact provider rejection message was not
available in the logs. Bounded, paginated relation reads and visible failure
handling are required before release.

Native Sheets comment content also needs a bounded fix: Google's limit is
2,048 UTF-8 bytes, including the exported attribution. Oversized messages
must remain intact in Let's Assist and hold the export with an accurate
reason before a provider write. They must not be truncated or reported as
an access failure. These fixes must use a new signed release; the published
1.2.25 tag remains immutable.

Private PR 339 prepares these fixes as application 1.2.26 at
`66fc21811137cc49988cd7143cf0fead0fb8641a`. It also retains staff without
student profiles in the reviewer directory and reports failed review-period
or policy reads. All 354 private test files pass, with mock-sensitive suites
isolated; host TypeScript, changed-file lint, full private formatting and ten
child application tests pass. Fictional tests retain 1,101 review subjects
and 13,212 related records. Independent review found no actionable P0-P2
issues. Private quality run `34598455585` passed, and PR 339 merged at
`bb819efce4f4c8c9597b3598f3665a3538243d53`. Private PR 340 prepares signed
publication; its quality run is `34598777650`. The root candidate now uses
the merged gitlink and passes the strict submodule check. This is prepared
code, not a deployed Production fix.

Private PR 340 and quality run `34598777650` passed. Signed release
`dvhs-csf/v1.2.26` uses source `bb819efce4f4c8c9597b3598f3665a3538243d53`;
publication run `34599102604` passed. Root integration run `34599200218`
stopped because root Development still used `f03e5a0` and the release changes
embedded code. The reviewed root gitlink update must land before retrying
the normal integration workflow. No guard, signature check or published
migration was changed to work around that refusal.

Workbook refresh and import processing remain paused. Email delivery and
scheduled publishing remain disabled. Copied-workbook native-thread
acceptance, the final Production student and staff journeys, live sync
enablement, and import resumption remain open. The earlier reconciliation
counts are dated evidence, not a claim that sources stopped changing.

### Signed application 1.2.25 publication candidate

Root PR 517 merged as `d87f37ed`. Private release workflow `34587750048` and root integration workflow `34587840744` passed for signed application source `fa78eeb753ab0af537490fc2b0b62e7b3bf67a3e`. Generated PR 518 starts at `660976ad` and adds `20260911101007_publish_dvhs_csf_1_2_25`, SHA256 `32cb2d89eca6ce9ac87defdd856973cffc5153cf3c87d8d5d89f513d27a684eb`. The application registry records that signed source; the serving private gitlink remains `f03e5a06d3c451bb721e90529b890d6199e60148`. Publication leaves organization installs and rollout selection unchanged.

The 484-migration catalog preserves the accepted 483 schema fingerprints. The forward release allowlist includes the exact publication bytes and supports a deployment starting from either 482 or 483. The sync catalog still covers 30 functions, ten relations, and 29 triggers. Verification passed 58 catalog and forward-release tests, 13 documentation tests, 21 release-integration tests, the registry gate, strict gitlink checks, and migration validation. Full isolated replay passed 484 migrations, 107 CSF tables, 275 files, and 7,907 assertions in 105 seconds. The accepted catalog and all ten negative probes passed; owned test resources were removed. These checks do not establish a hosted deployment or a completed copied-workbook journey. Production remains at the last verified 482-migration checkpoint.

### Signed application 1.2.26 publication candidate

Root PR 522 passed CI `34600061603`, including 7,907 database assertions,
93 CSF browser tests and three shared DV browser tests. It merged as
`77ab2bdd95deb0c29f294f0cd2ec8bd1b0d93686`; the merged tree matches the
reviewed `6aa584eb` candidate. Signed integration `34602252681` then passed
on that updated Development tree and opened PR 523 at `d7255a72`.

The generated forward migration is
`20260911130443_publish_dvhs_csf_1_2_26`, SHA256
`e1df91aa3e43d85d1fd0553c3a698a5df506bd032fb804249848395f21b2b9b7`.
It publishes signed source `bb819ef` with rollout zero and does not change
organization installations. Independent review passed for the migration
and its catalog integration. The 485-version ledger hash is
`8d650ea3d0d0148d14f9e57e1d52b1bd2bd8e8d61a71f4241dc1d59009adfd31`.
Earlier migration bytes and the accepted 483/484 schema fingerprints remain
unchanged. Sixty catalog and forward-release tests, 13 documentation tests,
the registry gate and strict gitlink checks passed. The final integrated
CI and hosted acceptance remain pending. No Production migration or
application activation occurred in this step.

### September 11 hosted result for application 1.2.26

PR 523 merged as `2f12eba7e31c3e38fced4cd3d1c73b69ec121f08`.
Both candidate CI `34602815136` and merged-tree CI `34603600211` passed,
including 7,915 database assertions, 93 CSF browser tests and three shared
DV browser tests. Four optional CSF tests were skipped. Development serves
host deployment `dpl_6D4SrrRSriTzXHbcvsVemBVYc7cP` and the signed 1.2.26
application. The fictional delivery organization selected that application
through the normal organization controls.

Hosted acceptance `34603595116` finished with failure at 13:55 UTC. Its
100 distinct authenticated identities made 9,184 requests, with 43 timeouts
and no HTTP 500 responses. Overall read p95 was 5,020.76 ms and p99 was
13,040.48 ms. The officer application route had p95 11,671.80 ms. These
exceed the existing read budgets. Mutations, browser vitals, 25 review
navigations and retained heap passed; the browser recorded zero errors.
The 0.4682 percent request error rate passed its threshold. Host runtime
logs for 13:39–13:56 UTC contained no error or fatal entries, but that does
not explain the slow reads or establish database capacity.

Production PR 519 remains unmerged. No Production release, migration,
application selection, compute change or worker resumption followed this
failed acceptance. Database measurements from the actual load interval
and the remaining query fanout are under review before another run.

Private PR 341 prepares application 1.2.27 at
`5176919d3a34977be57596b40837ff18064cb757`. Officer Home no longer fetches
detailed point-submission records that it does not render. Its pending
count still comes from the authorized Home snapshot. Submission, points
and profile routes retain their record reads and permission checks.
Independent behavior review, 12 focused/scale tests, six application access
tests, 18 release-tooling tests, TypeScript, lint and formatting passed.
Private quality run `34607981707` is pending. No latency improvement is
claimed until measured. This change does not authorize the proposed paid
Development compute upgrade.
