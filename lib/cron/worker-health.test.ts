import { expect, test } from "bun:test";
import {
  evaluateWorkerHealth,
  requireWorkerActivationMonitoring,
  type WorkerMonitoringPolicy,
} from "./worker-health";
const now = Date.parse("2040-01-01T12:00:00Z");
const scope = {
  worker: "csf-communications-dispatch" as const,
  environment: "production" as const,
  sourceSha: "a".repeat(40),
};
const policy: WorkerMonitoringPolicy = {
  ...scope,
  scheduler: "vercel",
  scheduleEnabled: true,
  expectedEverySeconds: 60,
  staleAfterSeconds: 180,
  maxRunSeconds: 50,
  verifiedAt: "2040-01-01T11:00:00Z",
  validUntil: "2040-01-02T11:00:00Z",
  changeRecord: "https://github.com/riddhimanrana/lets-assist/issues/1",
  reviewedBy: "fixture-operator",
  alerting: {
    owner: "fixture-operator",
    destination: "fixture-alerts",
    missedRunTestedAt: "2040-01-01T10:00:00Z",
    validUntil: "2040-01-02T10:00:00Z",
  },
};
const receipt = {
  run_id: "ba100000-0000-4000-8000-000000000001",
  worker_key: scope.worker,
  environment: scope.environment,
  source_sha: scope.sourceSha,
  started_at: "2040-01-01T11:59:40Z",
  finished_at: "2040-01-01T11:59:45Z",
  outcome: "processed",
  code: "completed",
  duration_ms: 5000,
  attempted: 1,
  completed: 1,
  failed: 0,
  pending: 0,
  refused: 0,
  faults: 0,
  deadline_reached: false,
};
test("long CSF worker budgets do not relax the budget for other workers", () => {
  for (const worker of [
    "csf-class-workbook-refresh",
    "csf-import-commit",
  ] as const) {
    const workerScope = { ...scope, worker };
    expect(
      requireWorkerActivationMonitoring(
        { ...policy, worker, maxRunSeconds: 800 },
        workerScope,
        now,
      ).maxRunSeconds,
    ).toBe(800);
    expect(() =>
      requireWorkerActivationMonitoring(
        { ...policy, worker, maxRunSeconds: 801 },
        workerScope,
        now,
      ),
    ).toThrow();
  }
  expect(() =>
    requireWorkerActivationMonitoring(
      { ...policy, maxRunSeconds: 601 },
      scope,
      now,
    ),
  ).toThrow();
});
test("health cannot infer an active schedule or alert from a successful worker receipt", () => {
  expect(evaluateWorkerHealth([receipt], null, scope, now)).toMatchObject({
    outcome: "no_run",
    code: "cadence_or_alerting_unverified",
    actionRequired: true,
  });
  expect(
    evaluateWorkerHealth(
      [receipt],
      { ...policy, scheduleEnabled: false },
      scope,
      now,
    ),
  ).toMatchObject({
    outcome: "no_run",
    code: "verified_paused",
    actionRequired: false,
  });
  expect(evaluateWorkerHealth([], policy, scope, now)).toMatchObject({
    outcome: "no_run",
    code: "no_execution_receipt",
    actionRequired: true,
  });
});
test("finished and crashed runs have distinct health outcomes", () => {
  expect(evaluateWorkerHealth([receipt], policy, scope, now)).toMatchObject({
    outcome: "processed",
    actionRequired: false,
  });
  expect(
    evaluateWorkerHealth(
      [
        {
          ...receipt,
          outcome: "no_run",
          code: "empty_queue",
          attempted: 0,
          completed: 0,
        },
      ],
      policy,
      scope,
      now,
    ),
  ).toMatchObject({
    outcome: "no_run",
    code: "empty_queue",
    actionRequired: false,
  });
  for (const [outcome, code] of [
    ["partial", "partial_work"],
    ["failed", "worker_failed"],
  ])
    expect(
      evaluateWorkerHealth(
        [{ ...receipt, outcome, code, failed: 1 }],
        policy,
        scope,
        now,
      ),
    ).toMatchObject({ outcome, actionRequired: true });
  expect(
    evaluateWorkerHealth(
      [{ ...receipt, outcome: "started", code: "started", finished_at: null }],
      policy,
      scope,
      now,
    ),
  ).toMatchObject({ outcome: "running", actionRequired: false });
  expect(
    evaluateWorkerHealth(
      [
        {
          ...receipt,
          outcome: "started",
          code: "started",
          finished_at: null,
          started_at: "2040-01-01T11:59:00Z",
        },
      ],
      policy,
      scope,
      now,
    ),
  ).toMatchObject({ outcome: "stale", code: "unfinished_run" });
  expect(
    evaluateWorkerHealth(
      [{ ...receipt, started_at: "2040-01-01T11:50:00Z" }],
      policy,
      scope,
      now,
    ),
  ).toMatchObject({ outcome: "stale", code: "missed_schedule" });
});
test("unknown scopes, deployments, raw fields and misleading success fail closed", () => {
  const cases = [
    { ...receipt, worker_key: "data-exports" },
    { ...receipt, source_sha: "b".repeat(40) },
    { ...receipt, error: "do not retain" },
    { ...receipt, failed: 1 },
    { ...receipt, started_at: "2041-01-01T00:00:00Z" },
    { ...receipt, outcome: "started", code: "started" },
  ];
  for (const row of cases)
    expect(evaluateWorkerHealth([row], policy, scope, now).outcome).toBe(
      "failed",
    );
  expect(
    evaluateWorkerHealth(Array(21).fill(receipt), policy, scope, now).outcome,
  ).toBe("failed");
});
test("activation evidence is exact, expiring, strict and requires a tested alert", () => {
  expect(requireWorkerActivationMonitoring(policy, scope, now)).toEqual(policy);
  for (const invalid of [
    null,
    { ...policy, sourceSha: "b".repeat(40) },
    { ...policy, validUntil: "2040-01-01T11:59:59Z" },
    { ...policy, validUntil: "2040-02-01T00:00:00Z" },
    { ...policy, expectedEverySeconds: 600 },
    { ...policy, scheduleEnabled: false },
    { ...policy, alerting: undefined },
    {
      ...policy,
      alerting: {
        ...policy.alerting,
        missedRunTestedAt: "2039-01-01T00:00:00Z",
      },
    },
    { ...policy, secret: "forbidden" },
  ])
    expect(() =>
      requireWorkerActivationMonitoring(invalid, scope, now),
    ).toThrow();
});
