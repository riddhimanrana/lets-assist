import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { checkWorkbookWorker } from "./check-csf-workbook-worker.mjs";

const sha = "a".repeat(40);
const env = {
  ACCEPTED_SHA: sha,
  CSF_WORKBOOK_CHECK_MODE: "verify-disabled",
  CSF_WORKBOOK_CONFIRMATION: "verify-disabled:ocbuygudvarsuxijxhau",
  SUPABASE_URL: "https://ocbuygudvarsuxijxhau.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fictional-database-key",
  CSF_WORKBOOK_WORKER_SECRET_TOKEN: "fictional-worker-key",
  VERCEL_AUTOMATION_BYPASS_SECRET: "fictional-bypass-key",
};
function fixture() {
  return [
    {
      service: "lets-assist",
      environment: "preview",
      version: sha,
      checks: [
        {
          name: "workers",
          details: {
            csfControlMode: "database",
            csfWorkbookRefresh: false,
            csfImportCommit: false,
            csfCommunications: false,
            csfScheduledPostPublisher: false,
          },
        },
      ],
    },
    {
      releaseSha: sha,
      revision: 1,
      workers: {
        workbook_refresh: false,
        import_commit: false,
        communications: false,
        scheduled_post_publisher: false,
      },
    },
    { enabled: false, claimed: 0, prepared: 0, blocked: 0 },
  ];
}
test("retired prepare-test refuses before reading or consuming any automatic queue", async () => {
  let calls = 0;
  await expect(
    checkWorkbookWorker(
      {
        ...env,
        CSF_WORKBOOK_CHECK_MODE: "prepare-test",
        CSF_WORKBOOK_CONFIRMATION: "prepare-test:ocbuygudvarsuxijxhau",
      },
      async () => {
        calls++;
        return Response.json({});
      },
    ),
  ).rejects.toThrow("cannot isolate this fixture");
  expect(calls).toBe(0);
});
test("disabled authentication requires matching runtime posture and saved controls", async () => {
  const rows = fixture();
  const calls: string[] = [];
  const result = await checkWorkbookWorker(env, async (url) => {
    calls.push(url);
    return Response.json(rows.shift());
  });
  expect(result).toMatchObject({
    authenticated: true,
    enabled: false,
    claimed: 0,
    receiptVerified: false,
  });
  expect(calls.filter((url) => url.includes("/api/cron/"))).toHaveLength(1);
});
test("wrong environment or missing credentials cannot start requests", async () => {
  for (const changes of [
    { SUPABASE_URL: "https://production.example.test" },
    { ACCEPTED_SHA: "main" },
    { CSF_WORKBOOK_WORKER_SECRET_TOKEN: "" },
    { CSF_WORKBOOK_CONFIRMATION: "wrong" },
  ]) {
    let calls = 0;
    await expect(
      checkWorkbookWorker({ ...env, ...changes }, async () => {
        calls++;
        return Response.json({});
      }),
    ).rejects.toThrow();
    expect(calls).toBe(0);
  }
});
test("unsafe effective worker settings stop before a worker call", async () => {
  for (const changes of [
    { csfControlMode: "environment" },
    { csfWorkbookRefresh: true },
    { csfImportCommit: true },
    { csfCommunications: true },
    { csfScheduledPostPublisher: true },
  ]) {
    const rows = fixture();
    Object.assign(rows[0].checks![0].details, changes);
    const calls: string[] = [];
    await expect(
      checkWorkbookWorker(env, async (url) => {
        calls.push(url);
        return Response.json(rows.shift());
      }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(1);
  }
});
test("mismatched saved controls stop before worker invocation", async () => {
  const rows = fixture();
  rows[1].workers!.workbook_refresh = true;
  const calls: string[] = [];
  await expect(
    checkWorkbookWorker(env, async (url) => {
      calls.push(url);
      return Response.json(rows.shift());
    }),
  ).rejects.toThrow();
  expect(calls).toHaveLength(2);
});
test("a lost worker response is not retried", async () => {
  const rows = fixture();
  let calls = 0;
  await expect(
    checkWorkbookWorker(env, async (url) => {
      if (url.includes("/api/cron/")) {
        calls++;
        throw new Error("Lost response");
      }
      return Response.json(rows.shift());
    }),
  ).rejects.toThrow();
  expect(calls).toBe(1);
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
    .split("  development-import-check:")[0];
  expect(job).toContain("environment: development");
  expect(job).toContain("secrets.CSF_WORKBOOK_WORKER_SECRET_TOKEN");
  expect(job).not.toContain("CRON_SECRET");
  expect(job).not.toContain("worker_control");
});
