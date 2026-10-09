# Worker execution health

All active platform cron routes record aggregate execution evidence. The
reviewed names live in `lib/cron/worker-keys.mjs`, including the new
`public-image-cleanup` worker. The retired CSF scheduled-post publisher cannot
create execution receipts. Instrumentation does not enable a worker or schedule.

## What the receipts prove

`lib/cron/worker-observation.ts` records a start before an enabled worker pass
and a finish after it returns. It uses a static worker name, server-derived
Vercel environment and build SHA. Authentication failures, the local auth probe,
disabled workers and status-only requests do not create execution receipts.
An auth probe proves authentication and routing only.

The service-only public RPCs write to `app_private.worker_run_receipts`. They
accept bounded aggregate counters and fixed outcome codes. They reject raw
errors, request fields, recipients and job identifiers. The service role cannot
write directly to the table. The architecture service RPC catalog must list
`start_worker_run_receipt(uuid,text,text,text)`,
`finish_worker_run_receipt(uuid,text,text,jsonb)` and
`read_worker_run_receipts(text,text)` as SECURITY DEFINER, VOLATILE functions
with an empty search path. They do not belong in the browser RPC allowlist.

Receipt writes have a 1.5 second timeout. Failure to record telemetry does not
change a worker's response or cause work to retry. An uncertain start stays
unobserved in that request; a later read may discover its started receipt.
An uncertain finish may leave a started receipt, which needs investigation.
Receipts are evidence of worker-reported outcomes, not proof of final inbox
delivery or an independent check of every domain write.

| Outcome                         | Meaning                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| `auth_probe`                    | Authentication and route shape only. Never an execution receipt.                        |
| `no_run / empty_queue`          | An enabled pass ran and reported no work.                                               |
| `no_run / no_execution_receipt` | No recent pass is recorded. Requires investigation when a verified schedule is enabled. |
| `processed`                     | The pass reported completed work with no unresolved aggregate failures.                 |
| `partial`                       | Some work completed, was refused, remains retryable, or reached its deadline.           |
| `failed`                        | The pass failed, returned invalid aggregates, or reported only failures.                |
| `running`                       | A start is recent and has no finish.                                                    |
| `stale`                         | A verified expected run was missed or a started run exceeded its duration budget.       |

Counter meanings differ by worker. Communications counts attempts and reported
send outcomes. Cancellation counts jobs and separate delivery or notification
faults. Do not add those counters together or label them all emails delivered.
For exports, completed counts ready archives. Unaccepted notifications add
faults, including uncertain sends that must not be retried automatically.
Cleanup-only success is processed with zero job counters; a failed cleanup adds
a fault. These counters do not claim inbox delivery.

Other workers count their own decisions:

| Worker                                               | Counter meaning                                                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public image cleanup                                 | Claimed objects finish as deleted, retained because still referenced, retryable, or failed. Completed combines deleted and retained decisions.                                       |
| Anonymous, waiver, paper scan, and CSF proof cleanup | Confirmed database cleanup and Storage operations. CSF proof counts also include enqueue and sweep decisions. These totals are not unique objects deleted.                           |
| AI moderation                                        | Checked items, applied moderation decisions, and warning counts. A clean scan can finish without flagging content.                                                                   |
| Automatic hours                                      | Processed sessions, successful sessions, deferred sessions, and per-session error counts. A failed query returns failure instead of an empty queue.                                  |
| Recurring projects                                   | Checked parents, parents that settled without errors, and failed parents. Multiple occurrence errors still count as one failed parent. Created occurrences are validated separately. |
| Organization calendar and sheet sync                 | Reported per-organization success or failure.                                                                                                                                        |
| Paper signup and feedback notifications              | Reported sends, skips, unknown outcomes, retries, and recovered stale attempts. Feedback also counts newly enqueued intents as completed queue decisions.                            |
| CSF publication notifications                        | Delivered bell notifications and skips; email handoff counts do not prove email delivery. An unavailable handoff adds a fault.                                                       |
| CSF import and workbook refresh                      | Settled jobs plus component-level preparation, queue, reconnect, and review decisions.                                                                                               |

The classifiers copy only fixed counters and outcome codes into receipts. They
do not persist recipients, source identities, returned job rows, or raw errors.
The default reader rejects invalid or oversized response evidence without
changing the business response. Calendar sync, sheet sync, moderation and automatic
hours capture their fixed counters before serializing larger results, so a valid
response above the reader limit does not create a false failure. An HTTP error
cannot be overridden by a captured successful summary. The two CSF workers with an 800-second route budget accept monitoring
budgets up to 800 seconds; other worker policies remain capped at 600 seconds.
Stored elapsed time has a 900-second ceiling so a legitimate long pass retains
its duration instead of failing the receipt write.

Reads return at most 20 receipts for one worker and environment, limited to the
last 30 days. Each start removes at most 200 expired rows, using a retention
index and skip-locked batches. This is bounded cleanup, not an enforced TTL.
If every worker is paused, physical rows can remain longer until a subsequent
start. Operators must review retained rows during a prolonged shutdown before
claiming physical deletion at 30 days. Do not run a mail worker to trigger
cleanup without its separate execution approval.

## Scheduler and alert evidence

`readWorkerHealth` accepts a current operator evidence receipt and the exact
worker/environment/build SHA being checked. `evaluateWorkerHealth` reports
`cadence_or_alerting_unverified` when that receipt is missing or expired. It
never infers a schedule from cron source, a Vercel Ready deployment, an HTTP 200,
or a successful auth probe.

The receipt records `worker`, `environment`, `sourceSha`, `scheduler`,
`scheduleEnabled`, `expectedEverySeconds`, `staleAfterSeconds`, `maxRunSeconds`,
`verifiedAt`, `validUntil`, `changeRecord`, `reviewedBy` and `alerting`.
`alerting` contains `owner`, a nonsecret `destination` identifier,
`missedRunTestedAt` and `validUntil`. The change record must be a repository PR
or issue. Never put tokens, webhook URLs or personal addresses in the receipt.

Before recording these fields, the operator must read the actual provider
schedule and deployment, confirm its cadence and enabled state, and test that
a missed run reaches the named owner through the recorded alert destination.
Use a synthetic missed-run check without calling a worker or draining a queue.
The receipt lasts at most seven days and binds one exact deployed SHA. Alert
test evidence lasts at most 30 days. The validator checks the receipt's shape,
scope and freshness. It cannot prove that the operator performed those steps.
Retain the provider readback and alert test evidence in the linked change record.

For any active Production CSF worker activation, paste the bounded receipt JSON into
`monitoring_evidence` on the existing worker-transition workflow. The controller
requires the dispatching operator to match `reviewedBy`; it refuses activation
before provider reads if the evidence is absent, expired or mismatched.
Disabling a worker needs no receipt. Workbook refresh, import commit,
communications, and publication notifications each require evidence for their
own worker identity.

The repository does not create an alert destination, activate a monitoring
scheduler, or send an alert from this change. A cloud worker without a tested
missed-run alert remains an operational gap. Vercel logs alone do not notify an
owner of an invocation that never happened. Only mark monitoring ready after
provider readback and the independent alert test are recorded.

## Validation and rollout

Deploy migrations `20261007051000_worker_run_health_receipts.sql` and
`20261008000000_extend_worker_observation_scope.sql` through the
reviewed migration path before the application hook. A missing migration leaves
domain work intact but causes a fixed monitoring-unavailable log and missing
receipts. Check effective service-only grants with
`supabase/tests/database/worker_run_health_receipts.test.sql`,
`supabase/tests/database/worker_observation_scope.test.sql`, and the architecture
service RPC catalog. Then verify aggregate-only receipts in an owned local
stack before hosted acceptance. No scheduler, worker switch or live queue should
be enabled as part of these source tests.

Focused unit tests cover classification, timeout-safe observation, response
preservation, missing telemetry, deployment binding, stale/crashed runs and
activation evidence refusal. The [cleanup register](cleanup-register.md) records
the accepted source and database evidence. Local execution does not prove hosted
monitoring. Physical retention during a prolonged pause and independent alert
provisioning remain operational work.
