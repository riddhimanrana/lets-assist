const APP = "https://dev.lets-assist.com";
const DATABASE = "https://ocbuygudvarsuxijxhau.supabase.co";
const ORG = "c5f11000-0000-4000-8000-000000000001";
const FILES = new Set([
  "1duk8oAKqID1vGgMV0WHyZQCtSMlpMsPzlglo5ulKw3o",
  "12yHSQXsMi69SN7qxw2OZ0Km59Kb17IOaUln-bb7-viE",
]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
function requireCondition(value, message) {
  if (!value) throw new Error(message);
}

export function validateImportReceipts(receipts) {
  requireCondition(
    Array.isArray(receipts) &&
      receipts.length > 0 &&
      receipts.length <= 8 &&
      receipts.every(
        (receipt) =>
          receipt &&
          [receipt.queueId, receipt.previewId, receipt.sourceId].every((id) =>
            UUID.test(id ?? ""),
          ) &&
          Number.isSafeInteger(receipt.rowCount) &&
          receipt.rowCount > 0,
      ) &&
      receipts.reduce((total, receipt) => total + receipt.rowCount, 0) <=
        1000 &&
      new Set(receipts.map((receipt) => receipt.queueId)).size ===
        receipts.length &&
      new Set(receipts.map((receipt) => receipt.previewId)).size ===
        receipts.length,
    "A bounded list of distinct fictional import receipts is required.",
  );
  return receipts;
}

export function validateImportQueue({
  queueId,
  previewId,
  sourceId,
  expectedRows,
  queues,
  previews,
  sources,
}) {
  const queue = queues[0];
  const preview = previews[0];
  const source = sources[0];
  requireCondition(
    queues.length === 1 &&
      queue.id === queueId &&
      queue.organization_id === ORG &&
      queue.preview_job_id === previewId &&
      queue.status === "queued" &&
      queue.attempt_count === 0 &&
      UUID.test(queue.actor_user_id ?? ""),
    "One untouched fictional officer-approved queue receipt is required, with no other active imports.",
  );
  requireCondition(
    previews.length === 1 &&
      preview.id === previewId &&
      preview.organization_id === ORG &&
      preview.source_id === sourceId &&
      preview.mode === "preview" &&
      ["completed", "needs_resolution"].includes(preview.status) &&
      preview.snapshot_row_count === expectedRows &&
      ["class_history", "application_responses"].includes(preview.source_type),
    "The queued preview must contain the expected fictional source rows.",
  );
  requireCondition(
    sources.length === 1 &&
      source.id === sourceId &&
      source.organization_id === ORG &&
      FILES.has(source.drive_file_id) &&
      source.drive_file_id === preview.source_file_id,
    "The import source must be one of the approved fictional workbooks.",
  );
}

/** @param {Record<string, string | undefined>} env
 * @param {typeof fetch} fetchImpl */
export async function checkImportWorker(env, fetchImpl = fetch) {
  const sha = env.ACCEPTED_SHA;
  const mode = env.CSF_IMPORT_CHECK_MODE;
  const commit = mode === "commit-test";
  requireCondition(
    ["verify-disabled", "commit-test"].includes(mode) &&
      /^[a-f0-9]{40}$/u.test(sha ?? "") &&
      env.SUPABASE_URL === DATABASE &&
      env.CSF_IMPORT_CONFIRMATION === `${mode}:ocbuygudvarsuxijxhau`,
    "An exact Development release and import-check confirmation are required.",
  );
  for (const key of [
    "SUPABASE_SERVICE_ROLE_KEY",
    "CSF_IMPORT_WORKER_SECRET_TOKEN",
    "VERCEL_AUTOMATION_BYPASS_SECRET",
  ]) {
    requireCondition(
      Boolean(env[key]?.trim()),
      "Development credentials are incomplete.",
    );
  }
  const request = commit
    ? JSON.parse(env.CSF_TEST_IMPORT_RECEIPT ?? "null")
    : {};
  if (commit && Array.isArray(request)) {
    const receipts = validateImportReceipts(request);
    let completedRows = 0;
    for (let index = 0; index < receipts.length; index += 1) {
      const result = await checkImportWorker(
        {
          ...env,
          CSF_TEST_IMPORT_RECEIPT: JSON.stringify({
            ...receipts[index],
            remainingReceipts: receipts.slice(index),
          }),
        },
        fetchImpl,
      );
      requireCondition(
        result.authenticated && result.receiptVerified,
        "Batch verification stopped. Inspect the saved receipt before another worker call.",
      );
      completedRows += result.completedRows;
    }
    return {
      mode,
      authenticated: true,
      receiptVerified: true,
      completedRows,
      completedPreviews: receipts.length,
      responseRecovered: false,
    };
  }
  requireCondition(
    request && typeof request === "object" && !Array.isArray(request),
    "An import receipt object is required.",
  );
  const { queueId, previewId, sourceId, rowCount: expectedRows } = request;
  const remaining = commit
    ? validateImportReceipts(request.remainingReceipts ?? [request])
    : [];
  if (commit) {
    requireCondition(
      [queueId, previewId, sourceId].every((id) => UUID.test(id ?? "")) &&
        Number.isSafeInteger(expectedRows) &&
        expectedRows > 0 &&
        expectedRows <= 1000,
      "Exact fictional receipts and a bounded row count are required.",
    );
    requireCondition(
      remaining[0].queueId === queueId &&
        remaining[0].previewId === previewId &&
        remaining[0].sourceId === sourceId &&
        remaining[0].rowCount === expectedRows,
      "The current receipt must be first in the frozen batch.",
    );
  }
  const appHeaders = {
    "x-vercel-protection-bypass": env.VERCEL_AUTOMATION_BYPASS_SECRET,
    "cache-control": "no-cache",
  };
  const dbHeaders = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
  };
  const readJson = async (url, options = {}) => {
    const response = await fetchImpl(url, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(840_000),
    });
    requireCondition(
      response.ok,
      "Development import verification request failed.",
    );
    return response.json();
  };
  const table = (name, query) =>
    readJson(`${DATABASE}/rest/v1/${name}?${query}`, {
      headers: { ...dbHeaders, "accept-profile": "plugin_data" },
    });
  const status = await readJson(`${APP}/api/status?deep=0`, {
    headers: appHeaders,
  });
  const workerChecks = (status.checks ?? []).filter(
    (item) => item.name === "workers",
  );
  const posture = workerChecks[0]?.details;
  requireCondition(
    status.service === "lets-assist" &&
      status.environment === "preview" &&
      status.version === sha &&
      workerChecks.length === 1 &&
      posture?.csfControlMode === "database" &&
      posture.csfImportCommit === commit &&
      posture.csfWorkbookRefresh === false &&
      posture.csfCommunications === false &&
      posture.csfScheduledPostPublisher === false,
    "Development release or effective worker posture does not match.",
  );
  const controls = await readJson(
    `${DATABASE}/rest/v1/rpc/read_csf_release_worker_controls`,
    {
      method: "POST",
      headers: dbHeaders,
      body: JSON.stringify({ p_release_sha: sha }),
    },
  );
  requireCondition(
    controls.releaseSha === sha &&
      Number.isSafeInteger(controls.revision) &&
      controls.workers?.import_commit === commit &&
      controls.workers.workbook_refresh === false &&
      controls.workers.communications === false &&
      controls.workers.scheduled_post_publisher === false,
    "Saved Development worker controls do not match.",
  );
  if (commit) {
    const [queues, previews, sources] = await Promise.all([
      table(
        "csf_import_commit_queue",
        `select=id,organization_id,preview_job_id,status,attempt_count,actor_user_id&status=in.(queued,running)&order=created_at.asc,id.asc&limit=${remaining.length + 1}`,
      ),
      table(
        "csf_sheet_import_jobs",
        `select=id,organization_id,source_id,source_file_id,source_type,mode,status,snapshot_row_count&id=in.(${remaining.map((item) => item.previewId).join(",")})&limit=${remaining.length + 1}`,
      ),
      table(
        "csf_sheet_sources",
        `select=id,organization_id,drive_file_id&id=in.(${remaining.map((item) => item.sourceId).join(",")})&limit=${remaining.length + 1}`,
      ),
    ]);
    requireCondition(
      queues.length === remaining.length &&
        queues.every((queue, index) => queue.id === remaining[index].queueId),
      "Active imports must match the frozen fictional batch in claim order.",
    );
    for (const item of remaining) {
      validateImportQueue({
        ...item,
        expectedRows: item.rowCount,
        queues: queues.filter((queue) => queue.id === item.queueId),
        previews: previews.filter((preview) => preview.id === item.previewId),
        sources: sources.filter((source) => source.id === item.sourceId),
      });
    }
  }
  let result;
  try {
    result = await readJson(`${APP}/api/cron/csf-import-commit`, {
      method: "POST",
      headers: {
        ...appHeaders,
        authorization: `Bearer ${env.CSF_IMPORT_WORKER_SECRET_TOKEN}`,
      },
    });
  } catch {
    requireCondition(
      commit,
      "The disabled import-worker check did not settle.",
    );
  }
  if (commit) {
    const [receipts, rows] = await Promise.all([
      table(
        "csf_import_commit_queue",
        `select=id,organization_id,preview_job_id,status,attempt_count,error_code&id=eq.${queueId}&limit=2`,
      ),
      table(
        "csf_sheet_import_rows",
        `select=id,import_status,commit_outcome_state&organization_id=eq.${ORG}&job_id=eq.${previewId}&limit=${expectedRows + 1}`,
      ),
    ]);
    const receipt = receipts[0];
    requireCondition(
      receipts.length === 1 &&
        receipt.id === queueId &&
        receipt.organization_id === ORG &&
        receipt.preview_job_id === previewId &&
        receipt.status === "completed" &&
        receipt.attempt_count === 1 &&
        receipt.error_code === null &&
        rows.length === expectedRows &&
        new Set(rows.map((row) => row.id)).size === expectedRows &&
        rows.every(
          (row) =>
            ["created", "updated"].includes(row.import_status) &&
            row.commit_outcome_state === "succeeded",
        ),
      "Saved receipts do not confirm every fictional row. Inspect them before another invocation.",
    );
  }
  if (result)
    requireCondition(
      result.enabled === commit &&
        result.claimed === (commit ? 1 : 0) &&
        result.completed === (commit ? 1 : 0) &&
        result.blocked === 0,
      "The import-worker response does not confirm completion.",
    );
  return {
    mode,
    authenticated: Boolean(result),
    receiptVerified: commit,
    completedRows: commit ? expectedRows : 0,
    responseRecovered: !result,
  };
}

if (import.meta.main) {
  try {
    const result = await checkImportWorker(process.env);
    console.log(JSON.stringify(result));
    if (!result.authenticated) process.exitCode = 1;
  } catch {
    console.error(
      "Development import check failed. Inspect receipts before retrying. No automatic retry occurred.",
    );
    process.exitCode = 1;
  }
}
