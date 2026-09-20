# Let's Assist system audit, September 19, 2026

## Assessment

The development process created too much integration work. The repository and provider evidence support that conclusion. From September 15 through September 19 UTC, the root repository received 172 PRs and the private-plugin repository received 120. Those counts include releases and integration PRs, not 292 independent product features. Work split across branches, repeated database fixes, publication migrations, release markers, and schema-verifier repairs caused repeated validation and deployment work.

The platform is not fully finished. Important member features exist and have hosted acceptance evidence, but identity review, attendance reconciliation, export backlog, dependency security, and Production performance still need work. A passing release does not close those items.

This report covers Git and disk cleanup, the original CSF requests, release state, critical code paths, database health and access controls, runtime errors, email configuration and delivery, CI activity, and cost drivers. Provider billing was verified in the follow-up below. A complete fresh end-to-end audit of every role remains unverified. This is not a claim that every line of code is defect-free.

## Follow-up status

The audit follow-up is being implemented in one root branch and one private-plugin branch. The follow-up also covers the requested post editor, draft actions, chapter sender, activity stream, and activity deletion.

- The certificate query no longer requests the private email column omitted by its verification view.
- Targeted dependency updates clear all six reported advisories. CI now runs the production dependency audit.
- One forward migration adds hourly, bounded cron-log retention: 30 days for successful runs and 90 days for failures, at most 50,000 completed runs per invocation. Running jobs remain untouched.
- Local type checking, lint, and 36 focused certificate/email tests pass. Isolated replay passes all 622 migrations and 9,898 assertions across 378 files. The earlier release-controller regression run passed 201 tests; the expanded controller suite now passes 321.
- A fresh destination-level read corrects the export finding below. Active destinations have zero pending exports, with 1,150 exported application records and 1,045 exported class/profile records. All 200 pending/retrying entries belong to one disabled legacy application destination. It refuses unverified response-row bindings and must remain disabled until a reviewed replacement or retirement resolves those entries.
- The 67 account requests include 13 without candidates, 53 with one candidate, and one with multiple candidates. A candidate count does not establish account ownership. These remain staff verification work.

These follow-up changes are local until a release receipt is recorded. Historical findings below describe the audit snapshot, not the final follow-up deployment.

## Production release

- Application commit: `293523193263933caa15a3bdeeaea6b6162bf949`.
- Vercel deployment: `dpl_5wYuZAhnLVLXLPHCvuzTcFR6bWx6`.
- [Application release run](https://github.com/riddhimanrana/lets-assist/actions/runs/35478202880) passed, including exact public alias verification, login availability, and protected-route authentication.
- [Forward migration reconciliation](https://github.com/riddhimanrana/lets-assist/actions/runs/35478116257) passed. Production has 621 migrations through `20260919230001`.
- [Controller repair PR #755](https://github.com/riddhimanrana/lets-assist/pull/755) merged. Main is `eec7b8e1e9c0bfc747b6ff833544dff9cce35a06`; the difference from the served application is the controller repair.
- Private plugin source is `1888ca808a2c9a532098b3ea3ae5dd13eb300150`, signed release `dvhs-csf/v1.2.55`.
- Live worker readback is revision 4 for the served application. Workbook refresh, import commit, communications, and publication notifications are enabled. Scheduled post publishing remains disabled, matching the prior state.
- Worker restoration runs: [workbooks](https://github.com/riddhimanrana/lets-assist/actions/runs/35478425525), [imports](https://github.com/riddhimanrana/lets-assist/actions/runs/35478447777), [communications](https://github.com/riddhimanrana/lets-assist/actions/runs/35478469363), [notifications](https://github.com/riddhimanrana/lets-assist/actions/runs/35478490495).

Hosted Development accepted commit `844973f0ef11c60a5d5eabc5d8f921fdd01ec84a` in [run 35474633862](https://github.com/riddhimanrana/lets-assist/actions/runs/35474633862). Its retained evidence reports 100 accounts/sessions, 9,732 requests, zero request errors or 5xx responses, zero browser errors, read p95 1,405.84 ms, and Applications p95 2,460.49 ms. That is Development evidence, not a Production latency measurement. No fresh student mutation or email-send walkthrough was performed during this audit.

## Git and local storage

At the start:

| Inventory                                | Root | Private plugin |
| ---------------------------------------- | ---: | -------------: |
| Local branches                           |  174 |             35 |
| Remote branches, excluding symbolic HEAD |  109 |             48 |
| Registered worktrees                     |   98 |             30 |
| Worktrees reporting dirty state          |   15 |              2 |

The primary checkout was stale and contained unresolved delete/modify conflicts in two release-worker files, 417 uncommitted historical register lines, and two private-plugin edits. Some worktrees also initialized independent private repositories. These needed separate preservation.

Cleanup preserves commit history in verified Git bundles and working files in recovery archives at `/Users/riddhiman.rana/Documents/lets-assist-recovery-20260919`. The archive includes dirty source, patches, configuration, branch-tip inventory, and independently initialized private repositories. Treat it as private: configurations and local evidence may contain credentials or student data. Do not publish it.

The cleanup deleted 107 remote root branches and 46 remote private branches with expected-SHA checks. Both remotes now contain only `main` and `development`. Deleting obsolete source branches closed their open PRs. This does not mean their unique work was merged. Open-PR inventories and the original branch tips are preserved for recovery and review. Historical PR records remain in GitHub.

Both repositories now automatically delete merged feature branches. Main and Development remain protected. Local branch cleanup also leaves only those two branch names. Cleanup removed 124 retired worktree directories after archiving their source, configuration, and evidence. Only the primary root worktree and its private submodule remain. Unique archived work was preserved, not silently merged into Development.

Generated caches inventoried for deletion totaled 36.54 GiB. Final free disk space increased from about 2.5 GiB to about 45 GiB, a net recovery of roughly 42 GiB after preserving recovery archives. Apparent cache sizes differ from reclaimed space because filesystems can share blocks or hardlinks. The primary dependency installation remains available. No global Docker volume prune was performed.

Docker inventory showed 19 images totaling 13.46 GB, 87 containers with 16 active, and 28 volumes totaling 2.22 GB. Docker spans other work, so broad deletion would not be justified by this repository cleanup.

## Original request coverage

| Requested outcome                                 | Evidence and remaining work                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sheets review, green/red/yellow/unreviewed status | Implemented with private staging and source mapping. The September 18 operator record reports repeat sync at zero changes and 250 unchanged. It also reports 263 unmatched source rows at that time. Those historical counts require a fresh source preview before corrections.                                          |
| Keep decisions pending until explicit release     | Live Production contains zero decision-release records. Release logic exists; no release was performed by this audit.                                                                                                                                                                                                    |
| Yellow explanation before release                 | Prior source audit found one yellow row without an explanation. Resolve source notes and re-preview before release.                                                                                                                                                                                                      |
| Regular and late applications                     | Both current sources were configured. The prior audit found duplicate late-source responses and missing imported applications. A refresh and reconciliation is still required.                                                                                                                                           |
| Account matching and claimed-profile flow         | Linking, claimed-record handling, reviewed connection actions, and public-route navigation have shipped changes. Live Production has 213 verified links and 67 requests needing review. This is not proof every profile is linked correctly.                                                                             |
| New/returning member queue                        | Implemented; queue remains operational work. Do not convert name similarity into account ownership.                                                                                                                                                                                                                      |
| Returning-member history and pending status       | Historical verified-point wording, Google Classroom explanation, accuracy note, and hidden unreconciled meeting count have prior Production browser evidence. A public-entry first-navigation defect was recorded earlier; repeat its regression on the latest release.                                                  |
| Merge without requiring every historical email    | Merge and identity controls received changes and tests. A fresh hosted collision/merge walkthrough is still part of final member-readiness acceptance.                                                                                                                                                                   |
| September meeting and attendance                  | Live database has 403 attended profiles: 130 Sheet records and 273 manual records, plus five unknown manual records. The existing source audit found 481 responses plus a header in the attachment, 472 timely responses, and 55 unresolved timely preview rows. Those are different counts, not 482 verified attendees. |
| Attendance cutoff                                 | Window handling and blocking of mixed invalid rows are in the release. Existing manual matches and unresolved rows still need source review; this audit adds no credit.                                                                                                                                                  |
| Clubs for 2026–27                                 | Live database contains 35 clubs. Verify term allocation and the supplied workbook club by club before calling year-long setup fully accepted. End-of-semester source connections remain future work.                                                                                                                     |
| Remove Classes 2024–2026                          | Prior audited retention removed 543 profile links and retired the three class anchors. Audit tombstones remain. This is not literal erasure of every historical row.                                                                                                                                                     |
| Multiline posts and lists                         | Implemented and included in the accepted private release.                                                                                                                                                                                                                                                                |
| Flyer images in posts                             | Implemented: up to four JPEG, PNG, or WebP images, descriptions, private signed delivery, and member-feed display. Latest release is now live; a real staff-upload walkthrough remains distinct from synthetic acceptance.                                                                                               |
| Detailed notifications and email                  | Implemented notification context, direct links, preference handling, and delivery ledger. Live CSF ledger contains six delivered entries. Provider-wide delivery metrics cannot prove each post/activity flow.                                                                                                           |
| Scheduled posts                                   | Publisher exists but remains disabled in Production. Do not promise scheduled publication as complete.                                                                                                                                                                                                                   |
| Sheets output to separate Let's Assist tabs       | Active destinations have zero pending work. All 200 held entries belong to a disabled legacy destination whose row bindings remain unverified.                                                                                                                                                                           |
| Member-directory speed                            | Query/index/loading changes exist. Earlier Production timing was about 6.35 seconds for a page turn. Latest Development performance passes, but fresh Production page-turn timings remain unmeasured.                                                                                                                    |
| Every profile and semester accurate               | Not complete. Outstanding identity/attendance reviews and partial application imports prevent this claim.                                                                                                                                                                                                                |

The source reconciliation counts above distinguish current SQL readback from older workbook/Sheet audit evidence. Sources change, so the report does not treat old snapshots as current approval to import.

## Findings, ordered by priority

### P1: Dependency audit is not clean

`bun audit --production` on the accepted release lockfile reports six advisories: one high and five moderate. The lockfile matches the served application. Findings cover Nodemailer, a baseline-browser-mapping resolution, and fflate through PostHog. The high advisory is Nodemailer address-parser denial of service. Runtime exposure still needs call-site analysis; an audit result alone does not prove exploitability.

The stale primary checkout reported additional Next.js/sharp advisories. Those are not assigned to the current Production artifact, whose Next.js pin is 16.3.3. This illustrates why exact-checkout verification matters.

Action: one dependency-maintenance change with reviewed compatible updates and focused email/build tests. The PR `quality` workflow should run the production dependency audit. It currently performs lint, types, tests, and build but does not invoke `security:audit`, even though `quality:static` includes it.

References: [Nodemailer address parsing](https://github.com/advisories/GHSA-2x7j-588g-ccc2), [baseline mapping](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv), [fflate](https://github.com/advisories/GHSA-px8p-9vwx-vf98).

### P1: Certificate page queries a nonexistent column

The current `app/certificates/[id]/page.tsx` selects `volunteer_email` from `certificate_verification_read_model`. Live database metadata confirms the view does not contain that column. Vercel reports a matching `42703` error. This is a confirmed code/schema mismatch, not just an old alert.

Action: remove the unsupported selection and keep private email out of the public verification model, then test a valid certificate and a missing/invalid identifier. Do not add private email to the public view merely to satisfy the query.

### P1: Operational work is incomplete

The live system has 67 connection requests needing review and 200 application exports pending or retrying. Earlier source evidence records 55 unresolved timely attendance rows and missing application imports. These need reviewed resolution, not another blanket migration or automatic name match.

Action: produce a fresh bounded preview, resolve identities with evidence, commit through the existing audited actions, and read the member result back. Count corrections and remaining conflicts after each batch.

### P1: Release process and status reporting obscure completion

The schema verifier retained checks for old function text after later migrations replaced those functions. That blocked reconciliation after the actual database transaction had committed. The repaired controller now passes live verification, but hand-maintained nested catalogs make repeated drift likely.

The cleanup register is thousands of lines of chronological updates with older open/closed statements interleaved. Its private-plugin guide says PR checks are short, while the current CI launches full database/browser work on every non-draft PR. Documentation and behavior disagree.

Action: generate one canonical final-schema manifest per release, keep drift/ACL checks, and replace scattered latest-status claims with one concise current-state table linking historical evidence. Do not weaken authorization checks to reduce runtime.

### P2: Cron history is the largest database object

Production database size is approximately 1.09 GB. `cron.job_run_details` alone uses about 615 MB. An exact follow-up count found 2,020,648 rows, with 1,827,843 older than 30 days. The earlier estimate of 1.6 million was PostgreSQL table statistics, not an exact count.

Five active database jobs produced 3,744 successful runs in the last 24 hours. No failure appeared in that grouped window. The table retains old runs; there is no visible cleanup job among the five configured jobs.

Action: define an operations-log retention period, summarize old failures, and add one bounded retention job. Plan vacuum separately; ordinary row deletion does not guarantee immediate filesystem shrinkage. Keep student and import audit evidence out of this cleanup. [Supabase cron retention documentation](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/cron/quickstart.mdx).

### P2: Request volume needs workload attribution

The connection snapshot showed 18 idle, two active, and seven background entries, with `max_connections=60`. This does not demonstrate connection exhaustion, nor does one snapshot rule out peaks.

Cumulative query statistics identify high call counts in Realtime and CSF sync:

| Operation                             |              Calls | Mean execution |
| ------------------------------------- | -----------------: | -------------: |
| Realtime-related top query            | about 4.95 million |        5.92 ms |
| `csf_sheet_sync_destination_snapshot` |          1,269,973 |        5.17 ms |
| `csf_record_sheet_sync_change`        |            569,784 |        4.12 ms |
| `csf_claim_sheet_sync_exports`        |              9,183 |       60.73 ms |
| `csf_commit_import_row_batch`         |              2,299 |      251.69 ms |
| `csf_append_import_preview_rows`      |                265 |      879.16 ms |

These are cumulative counters with an unverified statistics window. They cannot be converted into current requests per second. The new sync batching reduces a representative 410-RPC path to six RPCs in prior test evidence, but a post-deployment rate measurement is still needed.

Four Vercel CSF cron endpoints are configured every minute: 5,760 scheduled opportunities per day, or 172,800 in a 30-day month. Actual billed executions and duration were not obtained. Measure empty-queue work, batch sizes, Realtime subscriptions, request duplication, and queue latency before changing schedules.

### P2: Advisor volume requires classification

Supabase returned no ERROR-level security lint in this readback. It returned six WARN findings for authenticated execution of SECURITY DEFINER functions and 149 INFO findings for RLS-enabled tables without policies.

The six functions are explicitly listed in the repository architecture allowlist. Live readback shows anonymous execution denied and `auth.uid()` present in each definition. Private schemas have zero direct `anon`/`authenticated` table grants. Public tables all have RLS enabled. These observations support intentional controlled access; they are not a full authorization proof for every branch of each function.

Performance advisors report 316 unindexed foreign keys and 289 unused indexes, all INFO. Do not add hundreds of indexes or delete unused indexes in bulk. Prioritize populated tables, join plans, and mutation cost. Recently deployed or rare recovery indexes may correctly have zero scans.

References: [SECURITY DEFINER review](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [RLS without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

### P2: Email setup and delivery need a narrower operational view

Provider metrics for September 12–20 UTC: 268 sent, 262 delivered, six bounced, 26 delayed events, zero complaints, and zero failed events. Delivery rate is 97.76%; bounce rate is 2.24%. These are account-wide, not CSF-only. Open/click tracking is disabled on the four verified sending domains, so zero opens/clicks is not evidence nobody read the mail.

Resend has 19 topics, including Production, Development, and test audiences. It has six webhooks: two enabled and four disabled historical endpoints. The enabled endpoints include Production and Development. Some endpoint URLs carry deployment-bypass credentials in query parameters. Do not copy those URLs into logs or reports; review credential exposure/rotation with a no-gap webhook transition.

Dispatch code distinguishes unknown outcomes and refuses blind retries. That is necessary to avoid duplicate mail. Final acceptance must still demonstrate one authorized post notification, one activity notification, an opt-out, a direct link, and provider delivery settlement in the intended environment. No test message was sent during this audit.

### P2: CI and integration churn are avoidable cost drivers

The latest 1,000 root workflow records span September 16 14:47 UTC through September 20 00:20 UTC. The API sample is capped and is not a complete five-day count. It includes 293 Code quality runs and 126 hosted-acceptance runs. Across the sample, 198 were cancelled and 98 failed. Some runs are scheduled operations or external integrations, not CI builds; these counts are not billable minutes.

The last 98 migration filenames dated September 15 or later contain roughly 33,442 SQL lines. Several functions were replaced three or four times within that set. The ledger grew from 519 before September 15 to 621 now, a net increase of 102. Filename dates and Git arrival dates differ, explaining why those two counts are not identical.

Applied migrations must remain immutable. Deleting them to improve the count would break replay and the release ledger. Consolidate unpublished drafts before first deployment; consider a separately reviewed fresh-install baseline later without rewriting live history.

## Initial cost audit access limits (resolved September 20)

| Provider | Verified                                                                                                                                       | Still unavailable                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase | Pro plan, exactly main and one persistent Development branch, database size, table sizes, connections, jobs, advisors, storage-object metadata | Invoice totals, compute billing, egress, Auth/API peaks, credit balance and overage rates                                             |
| Vercel   | Successful deployment and exact alias check, runtime error clusters, four minutely cron definitions                                            | Team billing/usage page; the Chrome account exposes different teams and the project connector rejects its own declared argument shape |
| Resend   | Delivery totals, verified domains, topics, webhook configuration                                                                               | Plan/invoice totals; billing tools are unavailable and Chrome has no signed-in Resend session                                         |
| GitHub   | PR/branch inventory, sampled workflow counts, current protections                                                                              | Exact billed Actions minutes and storage charges                                                                                      |

These were the initial access limits. The signed-in follow-up below resolves the provider billing-page blockers; exact GitHub Actions charges and measured savings remain unverified.

## Billing and database follow-up, September 20 UTC

Signed-in billing pages now verify these figures. They cover different billing periods and are not a single fixed monthly quote.

| Provider | Verified current billing                                                  | Main drivers or limits                                                                                                                                |
| -------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel   | Upcoming invoice $75.33, cycle ending September 23                        | $40 platform/seats plus $35.33 usage after $20 credit. Observability events cost $23.46 for 19,551,721 events; build CPU costs $18.65 for 3d 18h 44m. |
| Supabase | Projected $44.14, September 16 through October 16; current accrued $27.61 | Pro plan $25; spend cap enabled. Exactly main and persistent development exist, both ACTIVE_HEALTHY.                                                  |
| Resend   | $20/month, renewal October 5                                              | 294 of 50,000 transactional emails used. Transactional overage disabled; four verified domains.                                                       |

No plans, seats, spending controls, or notification preferences were changed. Fewer repeated builds should reduce build charges, but no dollar savings have been measured yet.

Both hosted databases currently record 621 migrations through `20260919230001`. All plugin tables have RLS; anon and authenticated have zero plugin table grants. Pending local migrations are not yet deployed.

The refreshed Production and Development security advisors report the same findings and no ERROR entries. Security reports six authenticated SECURITY DEFINER entry points and 149 INFO notices for RLS tables without policies. Performance reports 316 missing-covering-index notices and 288 unused-index notices. These are a review inventory, not 759 demonstrated defects. The CSF access-context and route functions are intentional authenticated boundaries; server-only tables deliberately deny browser access without RLS policies. Some composite foreign-key notices already have indexes that narrow by the unique referenced identifier or by the same columns in another order. Do not add browser policies or drop indexes merely to reduce advisor counts.

### Database health and advisor classification

The September 20 Production sample measured 1,042 MB total database size and 22 connections (two active, 19 idle, one background). Cumulative database statistics report zero deadlocks. These are point-in-time and cumulative observations, not a load test or proof of peak capacity.

Cron execution history is the largest relation at 587 MB, followed by immutable CSF import rows at 183 MB, the writeback ledger at 74 MB, and the CSF audit log at 64 MB. The pending bounded cron-retention migration addresses disposable execution history without deleting student evidence. Deleting rows permits future page reuse; it does not guarantee an immediate reduction in the allocated file size or invoice.

Live definitions of all six advisor-flagged public SECURITY DEFINER functions were inspected. Five access/route helpers pin an empty search path and use the existing access-control chain. The staff-view preference function pins its path and requires an active staff/admin membership for the requested organization. These functions remain part of the authenticated API contract. Their warnings cannot be removed by revoking access without breaking callers. Continued review includes their delegated authorization functions and existing denial tests.

The highest cumulative CSF query totals belong to destination snapshots (1,269,975 calls, 5.17 ms mean) and recording sync changes (569,784 calls, 4.12 ms mean). Current source already batches these operations in groups of 100, so cumulative counts alone cannot establish a current polling defect. A before/after rate sample is required before changing worker schedules.

The 149 RLS-without-policy notices must remain fail-closed for server-only data. Adding permissive policies to clear those notices would expose data. Missing-index and unused-index notices require query-plan and constraint review before changes; no bulk index creation or removal has been performed.

## Working rules from here

1. Keep `main` and `development` as the only long-lived branches. Use one short-lived branch for a coherent change when review requires it, then remove it after merge. Default to one active root worktree and the private submodule; add an isolated worktree only for a concrete concurrent task.
2. Keep review fixes in the existing PR. Do not create separate PRs for every test correction, catalog repair, formatting change, or deployment marker.
3. Integrate the private change once, then update the root gitlink once. A private PR plus a root integration PR can be justified by the repository boundary; dozens of repeated integrations are not.
4. Finish the design and focused tests before publication. Group unpublished SQL into the smallest coherent migration set. Once deployed, preserve the ledger and use a forward correction.
5. Run fast relevant checks while iterating. Run the full database/browser release gate on the integrated candidate. Re-run it only when changed risk or a failure warrants it. Preserve security and authorization gates.
6. Deploy the tested artifact, then verify the actual served commit and worker state. Stop creating empty marker PRs to repair deployment coordination; fix the orchestration once.
7. Remove generated caches and retired worktrees at task close. Keep a compact private recovery archive for unique work; record exactly what was archived rather than pretending it merged.
8. Publish one status table with shipped, validated, operationally incomplete, and blocked entries. Separate code completion from real-data reconciliation and provider delivery.

The audit report, documentation index, cleanup-register entries, and repository working-rule changes are local edits. They have not been committed or pushed. GitHub automatic branch deletion is already enabled in both repositories.

## Next deliverables

- One focused reliability/security PR for the certificate mismatch, reviewed dependency updates, and a dependency-audit CI gate. Keep unrelated product changes out.
- One operational/performance change for bounded cron-history retention, query/queue metrics, and evidence-based scheduling/index decisions.
- One reviewed data-reconciliation pass for attendance, profile links, and current application imports/exports. This is staff work through existing tools, not a schema rewrite.
- Complete the invoice audit after account access is available, and run the remaining Production member and notification acceptance cases.

The audit found concrete defects and completed repository cleanup. It does not certify unfinished workflows as ready, and it does not justify another broad refactor before these specific items are addressed.

## Coordinated release candidate, September 20

Private release `dvhs-csf/v1.2.56` is signed at `593bddcab92ce700b108ff02cd802293baf02c72`. Cosign verified the tag-bound GitHub Actions identity and all release-asset checksums matched. The root integration uses the same reconstruction script inside PR #756 because the automatic integration on old Development correctly refused the not-yet-merged platform prerequisite.

The candidate includes the post editor dependency and Enter repair, visible formatting controls, separate draft/publish actions, activity stream links, guarded activity deletion, the chapter-specific sender for new campaigns, and attendance searches that include pending applicants. Review also corrected completion handling to use the submitted button choice. Existing campaign identities and receipts remain unchanged.

The schema comparison found a stale staff-permission function in hosted Development despite its ledger claiming the later migration, equivalent DV indexes with different names, and unnecessary local runtime MAINTAIN privileges. One forward migration restores the reviewed function, normalizes equivalent index names with definition guards, and revokes unnecessary privileges. Provider-owned default ACLs remain outside the repository contract; actual application-table grants remain fully checked.

The release manifest must come from the clean replay without local fixture helpers. It records complete function and relation fingerprints, ACLs, policies, constraints, triggers, and reviewed configuration. It rejects extra, missing, or changed objects.

Current Production query statistics show the common directory query averaging 55.52 ms over 390 calls and the common application page query averaging 4.91 ms over 388 calls. These cumulative averages have no known sampling-window start. The short live sample found no new calls to the two historically busiest import routines and roughly one automatic workbook claim/dispatch per minute. No index or worker-cadence change is justified by those observations alone.

Cron history has about 1.81 million completed rows already eligible under the reviewed retention windows. The hourly batch still caps deletion at 50,000. Cleanup can permit page reuse over time; neither immediate file shrinkage nor billing savings has been measured.

These candidate changes are not yet verified in hosted Development or Production. The final release receipt will record those environments separately.
