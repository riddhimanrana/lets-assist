import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  checkWorkbookWorker,
  validateWorkbookQueue,
} from "./check-csf-workbook-worker.mjs";

const organizationId = "c5f11000-0000-4000-8000-000000000001";
const cohortId = "c5f15100-0000-4000-8000-000000000001";
const workbookId = "249409ba-206d-4de6-a163-47e09016efa7";
const jobId = "63bfc5fb-6738-4564-8dc4-69c1cf0fe4e5";
const driveId = "1duk8oAKqID1vGgMV0WHyZQCtSMlpMsPzlglo5ulKw3o";
function fixtureQueue() {
  return {
    workbookId,
    jobId,
    workbooks: [
      {
        id: workbookId,
        organization_id: organizationId,
        cohort_id: cohortId,
        drive_file_id: driveId,
        provider_version: "9",
      },
    ],
    jobs: [
      {
        id: jobId,
        organization_id: organizationId,
        workbook_id: workbookId,
        drive_file_id: driveId,
        provider_version: "9",
        status: "queued",
        attempt_count: 0,
      },
    ],
  };
}

test("only the untouched fictional workbook job can pass preflight", () => {
  expect(() => validateWorkbookQueue(fixtureQueue())).not.toThrow();
  for (const field of [
    "organization_id",
    "cohort_id",
    "drive_file_id",
  ] as const) {
    const input = fixtureQueue();
    input.workbooks[0][field] = "different";
    expect(() => validateWorkbookQueue(input)).toThrow();
  }
  const otherJob = fixtureQueue();
  otherJob.jobs.push({ ...otherJob.jobs[0], id: "another-job" });
  expect(() => validateWorkbookQueue(otherJob)).toThrow();
  const attempted = fixtureQueue();
  attempted.jobs[0].attempt_count = 1;
  expect(() => validateWorkbookQueue(attempted)).toThrow();
  const stale = fixtureQueue();
  stale.jobs[0].provider_version = "8";
  expect(() => validateWorkbookQueue(stale)).toThrow();
});

const sha = "a".repeat(40);
const env = {
  ACCEPTED_SHA: sha,
  CSF_WORKBOOK_CHECK_MODE: "prepare-test",
  CSF_WORKBOOK_CONFIRMATION: "prepare-test:ocbuygudvarsuxijxhau",
  CSF_TEST_WORKBOOK_ID: workbookId,
  CSF_TEST_WORKBOOK_JOB_ID: jobId,
  SUPABASE_URL: "https://ocbuygudvarsuxijxhau.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fictional-database-key",
  CSF_WORKBOOK_WORKER_SECRET_TOKEN: "fictional-worker-key",
  VERCEL_AUTOMATION_BYPASS_SECRET: "fictional-bypass-key",
};
function responseFixture() {
  const queue = fixtureQueue();
  const status = {
    service: "lets-assist",
    environment: "preview",
    version: sha,
    checks: [
      {
        name: "workers",
        details: {
          csfControlMode: "database",
          csfWorkbookRefresh: true,
          csfImportCommit: false,
          csfCommunications: false,
          csfScheduledPostPublisher: false,
        },
      },
    ],
  };
  const controls = {
    releaseSha: sha,
    revision: 1,
    workers: {
      workbook_refresh: true,
      import_commit: false,
      communications: false,
      scheduled_post_publisher: false,
    },
  };
  const response = {
    enabled: true,
    claimed: 1,
    status: "completed",
    prepared: 4,
    templates: 4,
    blocked: 0,
  };
  const receipts = [
    {
      ...queue.jobs[0],
      status: "completed",
      attempt_count: 1,
      result_counts: { prepared: 4, templates: 4, blocked: 0 },
      error_code: null,
    },
  ];
  return [
    status,
    controls,
    queue.workbooks,
    queue.jobs,
    response,
    receipts,
  ] as [
    typeof status,
    typeof controls,
    typeof queue.workbooks,
    typeof queue.jobs,
    typeof response,
    typeof receipts,
  ];
}

test("preparation calls the worker once and requires its saved completion receipt", async () => {
  const responses = responseFixture();
  const requests: string[] = [];
  const fetcher = async (url: string) => {
    requests.push(url);
    return Response.json(responses.shift());
  };
  const result = await checkWorkbookWorker(env, fetcher);
  expect(result).toEqual({
    mode: "prepare-test",
    authenticated: true,
    enabled: true,
    claimed: 1,
    prepared: 4,
    templates: 4,
    blocked: 0,
    receiptVerified: true,
    responseRecovered: false,
  });
  expect(requests.filter((url) => url.includes("/api/cron/"))).toEqual([
    "https://dev.lets-assist.com/api/cron/csf-class-workbook-refresh",
  ]);
  expect(requests[3]).toContain("status=in.(queued,running)");
});

test("a lost worker response reads its receipt without calling the worker again", async () => {
  const responses = responseFixture();
  const requests: string[] = [];
  const fetcher = async (url: string) => {
    requests.push(url);
    const result = responses.shift();
    if (url.includes("/api/cron/")) throw new Error("Transport interrupted");
    return Response.json(result);
  };
  const result = await checkWorkbookWorker(env, fetcher);
  expect(result).toMatchObject({
    receiptVerified: true,
    responseRecovered: true,
    authenticated: false,
    prepared: 4,
    templates: 4,
  });
  expect(requests.filter((url) => url.includes("/api/cron/"))).toHaveLength(1);
  expect(requests.at(-1)).toContain(`id=eq.${jobId}`);
});

test("wrong environment and malformed receipts cannot start any requests", async () => {
  for (const changes of [
    { SUPABASE_URL: "https://production.example.test" },
    { ACCEPTED_SHA: "development" },
    { CSF_WORKBOOK_CONFIRMATION: "prepare-test:production" },
    { CSF_TEST_WORKBOOK_JOB_ID: "x&status=queued" },
    { CSF_WORKBOOK_WORKER_SECRET_TOKEN: "" },
  ]) {
    let requests = 0;
    await expect(
      checkWorkbookWorker({ ...env, ...changes }, async () => {
        requests += 1;
        return Response.json({});
      }),
    ).rejects.toThrow();
    expect(requests).toBe(0);
  }
});

test("stale release or mismatched runtime controls prevent the worker call", async () => {
  for (const mutate of [
    (rows: ReturnType<typeof responseFixture>) => {
      rows[0].version = "b".repeat(40);
    },
    (rows: ReturnType<typeof responseFixture>) => {
      rows[0].checks[0].details.csfCommunications = true;
    },
    (rows: ReturnType<typeof responseFixture>) => {
      rows[1].workers.import_commit = true;
    },
    (rows: ReturnType<typeof responseFixture>) => {
      rows[3].push({ ...rows[3][0], id: "another" });
    },
  ]) {
    const responses = responseFixture();
    mutate(responses);
    let called = false;
    await expect(
      checkWorkbookWorker(env, async (url: string) => {
        if (url.includes("/api/cron/")) called = true;
        return Response.json(responses.shift());
      }),
    ).rejects.toThrow();
    expect(called).toBe(false);
  }
});

test("missing completion or changed receipt never reports preparation success", async () => {
  for (const mutate of [
    (row: ReturnType<typeof responseFixture>[5][number]) => {
      row.status = "running";
    },
    (row: ReturnType<typeof responseFixture>[5][number]) => {
      row.workbook_id = "other";
    },
    (row: ReturnType<typeof responseFixture>[5][number]) => {
      row.result_counts.prepared = 3;
    },
    (row: ReturnType<typeof responseFixture>[5][number]) => {
      row.attempt_count = 2;
    },
  ]) {
    const responses = responseFixture();
    mutate(responses[5][0]);
    let calls = 0;
    await expect(
      checkWorkbookWorker(env, async (url: string) => {
        if (url.includes("/api/cron/")) calls += 1;
        return Response.json(responses.shift());
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  }
});

test("the disabled-worker check authenticates without a queue write", async () => {
  const fixture = responseFixture();
  fixture[0].checks[0].details.csfWorkbookRefresh = false;
  fixture[1].workers.workbook_refresh = false;
  const responses = [
    fixture[0],
    fixture[1],
    { enabled: false, claimed: 0, prepared: 0, blocked: 0 },
  ];
  const result = await checkWorkbookWorker(
    {
      ...env,
      CSF_WORKBOOK_CHECK_MODE: "verify-disabled",
      CSF_WORKBOOK_CONFIRMATION: "verify-disabled:ocbuygudvarsuxijxhau",
    },
    async () => Response.json(responses.shift()),
  );
  expect(result).toMatchObject({
    authenticated: true,
    enabled: false,
    claimed: 0,
    prepared: 0,
    receiptVerified: false,
  });
});

test("the workbook workflow uses only the dedicated Development credential", () => {
  const workflow = readFileSync(
    new URL(
      "../../.github/workflows/csf-communications-dispatch.yml",
      import.meta.url,
    ),
    "utf8",
  );
  const job = workflow
    .split("  development-workbook-check:")[1]
    .split("  dispatch:")[0];
  expect(job).toContain(
    "github.ref == 'refs/heads/development' && inputs.target == 'development' && inputs.worker == 'workbook'",
  );
  expect(job).toContain("environment: development");
  expect(job).toContain("secrets.CSF_WORKBOOK_WORKER_SECRET_TOKEN");
  expect(job).not.toContain("CRON_SECRET");
  expect(job).not.toContain("COMMUNICATIONS_WORKER_SECRET_TOKEN");
  expect(job).not.toContain("worker_control");
});
