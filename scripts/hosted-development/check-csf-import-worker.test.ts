import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { checkImportWorker } from "./check-csf-import-worker.mjs";

const org = "c5f11000-0000-4000-8000-000000000001";
const queueId = "00000000-0000-4000-8000-000000000001";
const previewId = "00000000-0000-4000-8000-000000000002";
const sourceId = "00000000-0000-4000-8000-000000000003";
const fileId = "12yHSQXsMi69SN7qxw2OZ0Km59Kb17IOaUln-bb7-viE";
const sha = "a".repeat(40);
const env = {
  ACCEPTED_SHA: sha,
  CSF_IMPORT_CHECK_MODE: "commit-test",
  CSF_IMPORT_CONFIRMATION: "commit-test:ocbuygudvarsuxijxhau",
  CSF_TEST_IMPORT_RECEIPT: JSON.stringify({
    queueId,
    previewId,
    sourceId,
    rowCount: 4,
  }),
  SUPABASE_URL: "https://ocbuygudvarsuxijxhau.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fictional-database-key",
  CSF_IMPORT_WORKER_SECRET_TOKEN: "fictional-worker-key",
  VERCEL_AUTOMATION_BYPASS_SECRET: "fictional-bypass-key",
};

function harness(
  options: {
    foreign?: boolean;
    duplicate?: boolean;
    attempted?: boolean;
    lost?: boolean;
    unknownRow?: boolean;
    disabled?: boolean;
    wrongSha?: boolean;
  } = {},
) {
  let sends = 0;
  const queue = {
    id: queueId,
    organization_id: options.foreign ? "other" : org,
    preview_job_id: previewId,
    status: "queued",
    attempt_count: options.attempted ? 1 : 0,
    actor_user_id: queueId,
  };
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    expect(init?.redirect).toBe("error");
    if (url.includes("/api/status"))
      return Response.json({
        service: "lets-assist",
        environment: "preview",
        version: options.wrongSha ? "b".repeat(40) : sha,
        checks: [
          {
            name: "workers",
            details: {
              csfControlMode: "database",
              csfImportCommit: !options.disabled,
              csfWorkbookRefresh: false,
              csfCommunications: false,
              csfScheduledPostPublisher: false,
            },
          },
        ],
      });
    if (url.includes("/rpc/"))
      return Response.json({
        releaseSha: sha,
        revision: 1,
        workers: {
          import_commit: !options.disabled,
          workbook_refresh: false,
          communications: false,
          scheduled_post_publisher: false,
        },
      });
    if (url.includes("/api/cron/")) {
      sends += 1;
      expect(init?.method).toBe("POST");
      if (options.lost) throw new Error("fictional transport failure");
      return Response.json({
        enabled: !options.disabled,
        claimed: options.disabled ? 0 : 1,
        completed: options.disabled ? 0 : 1,
        blocked: 0,
      });
    }
    if (url.includes("/csf_import_commit_queue?")) {
      if (url.includes("status=in."))
        return Response.json(
          options.duplicate ? [queue, { ...queue, id: previewId }] : [queue],
        );
      return Response.json([
        { ...queue, status: "completed", attempt_count: 1, error_code: null },
      ]);
    }
    if (url.includes("/csf_sheet_import_jobs?"))
      return Response.json([
        {
          id: previewId,
          organization_id: org,
          source_id: sourceId,
          source_file_id: fileId,
          source_type: "application_responses",
          mode: "preview",
          status: "needs_resolution",
          snapshot_row_count: 4,
        },
      ]);
    if (url.includes("/csf_sheet_sources?"))
      return Response.json([
        { id: sourceId, organization_id: org, drive_file_id: fileId },
      ]);
    if (url.includes("/csf_sheet_import_rows?"))
      return Response.json(
        Array.from({ length: 4 }, (_, index) => ({
          id: String(index),
          import_status: "created",
          commit_outcome_state:
            options.unknownRow && index === 3 ? "unknown" : "succeeded",
        })),
      );
    throw new Error("Unexpected test request");
  }) as typeof fetch;
  return { fetcher, sends: () => sends };
}

test("one authorized call requires queue settlement and every row outcome", async () => {
  const run = harness();
  expect(await checkImportWorker(env, run.fetcher)).toMatchObject({
    authenticated: true,
    receiptVerified: true,
    completedRows: 4,
  });
  expect(run.sends()).toBe(1);
});
test.each(["foreign", "duplicate", "attempted", "wrongSha"] as const)(
  "%s preflight never starts a worker",
  async (flag) => {
    const run = harness({ [flag]: true });
    await expect(checkImportWorker(env, run.fetcher)).rejects.toThrow();
    expect(run.sends()).toBe(0);
  },
);
test("a lost response reads receipts without resending or claiming HTTP proof", async () => {
  const run = harness({ lost: true });
  expect(await checkImportWorker(env, run.fetcher)).toMatchObject({
    authenticated: false,
    receiptVerified: true,
    responseRecovered: true,
  });
  expect(run.sends()).toBe(1);
});
test("an unknown row prevents a successful queue receipt from implying completion", async () => {
  const run = harness({ unknownRow: true });
  await expect(checkImportWorker(env, run.fetcher)).rejects.toThrow(
    "Saved receipts",
  );
  expect(run.sends()).toBe(1);
});
test("disabled authentication proof creates no commit claim", async () => {
  const run = harness({ disabled: true });
  expect(
    await checkImportWorker(
      {
        ...env,
        CSF_IMPORT_CHECK_MODE: "verify-disabled",
        CSF_IMPORT_CONFIRMATION: "verify-disabled:ocbuygudvarsuxijxhau",
      },
      run.fetcher,
    ),
  ).toMatchObject({
    authenticated: true,
    receiptVerified: false,
    completedRows: 0,
  });
});
test("the import workflow cannot enter the Production communications branch", () => {
  const workflow = readFileSync(
    new URL(
      "../../.github/workflows/csf-communications-dispatch.yml",
      import.meta.url,
    ),
    "utf8",
  );
  const job = workflow.slice(
    workflow.indexOf("  development-import-check:"),
    workflow.indexOf("  dispatch:"),
  );
  expect(job).toContain("inputs.target == 'development'");
  expect(job).toContain("inputs.worker == 'import'");
  expect(job).toContain("environment: development");
  expect(workflow.slice(workflow.indexOf("  dispatch:"))).toContain(
    "inputs.worker == 'communications'",
  );
});
