# Worker execution health

The first instrumented routes are `project-cancellations` and
`csf-communications-dispatch`. The shared hook also accepts `data-exports` with
an explicit classifier. The export route must wire that hook before its health
can be inferred from receipts. Other workers still need instrumentation.

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
The export classifier must keep archive completion separate from accepted
notification delivery.

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

For Production communications activation, paste the bounded receipt JSON into
`monitoring_evidence` on the existing worker-transition workflow. The controller
requires the dispatching operator to match `reviewedBy`; it refuses activation
before provider reads if the evidence is absent, expired or mismatched.
Disabling communications needs no receipt. Other worker switches preserve their
existing interface until their instrumentation and monitoring checks are added.

The repository does not create an alert destination, activate a monitoring
scheduler, or send an alert from this change. A cloud worker without a tested
missed-run alert remains an operational gap. Vercel logs alone do not notify an
owner of an invocation that never happened. Only mark monitoring ready after
provider readback and the independent alert test are recorded.

## Validation and rollout

Deploy migration `20261007051000_worker_run_health_receipts.sql` through the
reviewed migration path before the application hook. A missing migration leaves
domain work intact but causes a fixed monitoring-unavailable log and missing
receipts. Check effective service-only grants with
`supabase/tests/database/worker_run_health_receipts.test.sql` and the architecture
service RPC catalog. Then verify aggregate-only receipts in an owned local
stack before hosted acceptance. No scheduler, worker switch or live queue should
be enabled as part of these source tests.

Focused unit tests cover classification, timeout-safe observation, response
preservation, missing telemetry, deployment binding, stale/crashed runs and
activation evidence refusal. The authored database tests still require an
owned database replay; source validation does not replace execution. Broader
worker coverage, physical retention during a prolonged pause, and independent
alert provisioning remain follow-up work.
