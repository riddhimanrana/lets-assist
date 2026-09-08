const APP_ORIGIN = "https://dev.lets-assist.com";
const DATABASE_ORIGIN = "https://ocbuygudvarsuxijxhau.supabase.co";
const FIXTURE_ORG = "c5f11000-0000-4000-8000-000000000001";
const FIXTURE_COHORT = "c5f15100-0000-4000-8000-000000000001";
const FIXTURE_DRIVE = "1duk8oAKqID1vGgMV0WHyZQCtSMlpMsPzlglo5ulKw3o";

function requireCondition(value, message) {
  if (!value) throw new Error(message);
}

export function validateWorkbookQueue({ workbookId, jobId, workbooks, jobs }) {
  const workbook = workbooks[0];
  const job = jobs[0];
  requireCondition(
    workbooks.length === 1 &&
      workbook.id === workbookId &&
      workbook.organization_id === FIXTURE_ORG &&
      workbook.cohort_id === FIXTURE_COHORT &&
      workbook.drive_file_id === FIXTURE_DRIVE &&
      /^[1-9][0-9]{0,18}$/u.test(workbook.provider_version),
    "The workbook must be the linked fictional Development source.",
  );
  requireCondition(
    jobs.length === 1 &&
      job.id === jobId &&
      job.organization_id === FIXTURE_ORG &&
      job.workbook_id === workbookId &&
      job.drive_file_id === FIXTURE_DRIVE &&
      job.provider_version === workbook.provider_version &&
      job.status === "queued" &&
      job.attempt_count === 0,
    "Preparation requires one untouched fictional job and no other active refresh jobs.",
  );
}

/** @param {Record<string, string | undefined>} env
 * @param {(url: string, options: RequestInit) => Promise<Response>} fetchImpl */
export async function checkWorkbookWorker(env, fetchImpl = fetch) {
  const mode = env.CSF_WORKBOOK_CHECK_MODE;
  const sha = env.ACCEPTED_SHA;
  const workbookId = env.CSF_TEST_WORKBOOK_ID;
  const jobId = env.CSF_TEST_WORKBOOK_JOB_ID;
  const prepare = mode === "prepare-test";
  requireCondition(
    ["verify-disabled", "prepare-test"].includes(mode) &&
      /^[a-f0-9]{40}$/u.test(sha ?? "") &&
      env.SUPABASE_URL === DATABASE_ORIGIN &&
      env.CSF_WORKBOOK_CONFIRMATION === `${mode}:ocbuygudvarsuxijxhau`,
    "An exact Development release and workbook-check confirmation are required.",
  );
  if (prepare) {
    const uuid =
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
    requireCondition(
      uuid.test(workbookId ?? "") && uuid.test(jobId ?? ""),
      "The linked workbook and queued job receipts are required.",
    );
  }
  for (const key of [
    "SUPABASE_SERVICE_ROLE_KEY",
    "CSF_WORKBOOK_WORKER_SECRET_TOKEN",
    "VERCEL_AUTOMATION_BYPASS_SECRET",
  ]) {
    requireCondition(
      Boolean(env[key]?.trim()),
      "Development credentials are incomplete.",
    );
  }
  const readJson = async (url, options = {}) => {
    const response = await fetchImpl(url, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(600_000),
    });
    requireCondition(response.ok, "Development verification request failed.");
    return response.json();
  };
  const appHeaders = {
    "x-vercel-protection-bypass": env.VERCEL_AUTOMATION_BYPASS_SECRET,
    "cache-control": "no-cache",
  };
  const dbHeaders = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
  };
  const readTable = (table, query) =>
    readJson(`${DATABASE_ORIGIN}/rest/v1/${table}?${query}`, {
      headers: { ...dbHeaders, "accept-profile": "plugin_data" },
    });
  const status = await readJson(`${APP_ORIGIN}/api/status?deep=0`, {
    headers: appHeaders,
  });
  const workerChecks = (status.checks ?? []).filter(
    (row) => row.name === "workers",
  );
  const posture = workerChecks[0]?.details;
  requireCondition(
    status.service === "lets-assist" &&
      status.environment === "preview" &&
      status.version === sha &&
      workerChecks.length === 1 &&
      posture?.csfControlMode === "database" &&
      posture.csfWorkbookRefresh === prepare &&
      posture.csfImportCommit === false &&
      posture.csfCommunications === false &&
      posture.csfScheduledPostPublisher === false,
    "Development is not serving the expected release and worker posture.",
  );
  const controls = await readJson(
    `${DATABASE_ORIGIN}/rest/v1/rpc/read_csf_release_worker_controls`,
    {
      method: "POST",
      headers: dbHeaders,
      body: JSON.stringify({ p_release_sha: sha }),
    },
  );
  requireCondition(
    controls.releaseSha === sha &&
      Number.isSafeInteger(controls.revision) &&
      controls.workers?.workbook_refresh === prepare &&
      controls.workers.import_commit === false &&
      controls.workers.communications === false &&
      controls.workers.scheduled_post_publisher === false,
    "Saved Development worker controls do not match.",
  );
  let queue;
  if (prepare) {
    const workbooks = await readTable(
      "csf_class_workbooks",
      `select=id,organization_id,cohort_id,drive_file_id,provider_version&id=eq.${workbookId}&limit=2`,
    );
    const jobs = await readTable(
      "csf_class_workbook_refresh_jobs",
      "select=id,organization_id,workbook_id,drive_file_id,provider_version,status,attempt_count&status=in.(queued,running)&limit=2",
    );
    queue = { workbookId, jobId, workbooks, jobs };
    validateWorkbookQueue(queue);
  }
  let result;
  try {
    result = await readJson(
      `${APP_ORIGIN}/api/cron/csf-class-workbook-refresh`,
      {
        method: "POST",
        headers: {
          ...appHeaders,
          authorization: `Bearer ${env.CSF_WORKBOOK_WORKER_SECRET_TOKEN}`,
        },
      },
    );
  } catch {
    requireCondition(
      prepare,
      "The disabled-worker authentication check did not settle.",
    );
  }
  if (prepare) {
    const rows = await readTable(
      "csf_class_workbook_refresh_jobs",
      `select=id,organization_id,workbook_id,drive_file_id,provider_version,status,attempt_count,result_counts,error_code&id=eq.${jobId}&limit=2`,
    );
    const receipt = rows[0];
    requireCondition(
      rows.length === 1 &&
        receipt.id === jobId &&
        receipt.organization_id === FIXTURE_ORG &&
        receipt.workbook_id === workbookId &&
        receipt.drive_file_id === FIXTURE_DRIVE &&
        receipt.provider_version === queue.jobs[0].provider_version &&
        receipt.status === "completed" &&
        receipt.attempt_count === 1 &&
        receipt.result_counts?.prepared === 4 &&
        receipt.result_counts.templates === 4 &&
        receipt.result_counts.blocked === 0 &&
        receipt.error_code === null,
      "The saved workbook receipt does not confirm this preparation.",
    );
  }
  if (result) {
    requireCondition(
      result.enabled === prepare &&
        result.claimed === (prepare ? 1 : 0) &&
        result.prepared === (prepare ? 4 : 0) &&
        result.blocked === 0 &&
        (!prepare || (result.status === "completed" && result.templates === 4)),
      "Unexpected worker outcome. Inspect the saved receipt before another invocation.",
    );
  }
  return {
    mode,
    authenticated: Boolean(result),
    enabled: prepare,
    claimed: prepare ? 1 : 0,
    prepared: prepare ? 4 : 0,
    templates: prepare ? 4 : 0,
    blocked: 0,
    receiptVerified: prepare,
    responseRecovered: !result,
  };
}

if (import.meta.main) {
  try {
    const result = await checkWorkbookWorker(process.env);
    console.log(JSON.stringify(result));
    // A recovered receipt confirms data, not a successful authenticated HTTP check.
    if (!result.authenticated) process.exitCode = 1;
  } catch {
    console.error(
      "Development workbook check failed. Inspect its receipt before retrying. No automatic retry occurred.",
    );
    process.exitCode = 1;
  }
}
