const APP_ORIGIN = "https://dev.lets-assist.com";
const DATABASE_ORIGIN = "https://ocbuygudvarsuxijxhau.supabase.co";

function requireCondition(value, message) {
  if (!value) throw new Error(message);
}

/** @param {Record<string, string | undefined>} env
 * @param {(url: string, options: RequestInit) => Promise<Response>} fetchImpl */
export async function checkWorkbookWorker(env, fetchImpl = fetch) {
  const mode = env.CSF_WORKBOOK_CHECK_MODE;
  const sha = env.ACCEPTED_SHA;
  requireCondition(
    mode !== "prepare-test",
    "Single-workbook preparation testing is retired. The route processes other automatic queues and cannot isolate this fixture.",
  );
  requireCondition(
    mode === "verify-disabled" &&
      /^[a-f0-9]{40}$/u.test(sha ?? "") &&
      env.SUPABASE_URL === DATABASE_ORIGIN &&
      env.CSF_WORKBOOK_CONFIRMATION === "verify-disabled:ocbuygudvarsuxijxhau",
    "An exact Development release and disabled-worker confirmation are required.",
  );
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
      signal: AbortSignal.timeout(30_000),
    });
    requireCondition(response.ok, "Development verification request failed.");
    return response.json();
  };
  const appHeaders = {
    "x-vercel-protection-bypass": env.VERCEL_AUTOMATION_BYPASS_SECRET,
    "cache-control": "no-cache",
  };
  const status = await readJson(`${APP_ORIGIN}/api/status?deep=0`, {
    headers: appHeaders,
  });
  const checks = (status.checks ?? []).filter((row) => row.name === "workers");
  const posture = checks[0]?.details;
  requireCondition(
    status.service === "lets-assist" &&
      status.environment === "preview" &&
      status.version === sha &&
      checks.length === 1 &&
      posture?.csfControlMode === "database" &&
      posture.csfWorkbookRefresh === false &&
      posture.csfImportCommit === false &&
      posture.csfCommunications === false &&
      posture.csfScheduledPostPublisher === false,
    "Development is not serving the expected release and disabled worker posture.",
  );
  const controls = await readJson(
    `${DATABASE_ORIGIN}/rest/v1/rpc/read_csf_release_worker_controls`,
    {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_release_sha: sha }),
    },
  );
  requireCondition(
    controls.releaseSha === sha &&
      Number.isSafeInteger(controls.revision) &&
      controls.workers?.workbook_refresh === false &&
      controls.workers.import_commit === false &&
      controls.workers.communications === false &&
      controls.workers.scheduled_post_publisher === false,
    "Saved Development worker controls do not match.",
  );
  const result = await readJson(
    `${APP_ORIGIN}/api/cron/csf-class-workbook-refresh`,
    {
      method: "POST",
      headers: {
        ...appHeaders,
        authorization: `Bearer ${env.CSF_WORKBOOK_WORKER_SECRET_TOKEN}`,
      },
    },
  );
  requireCondition(
    result.enabled === false &&
      result.claimed === 0 &&
      result.prepared === 0 &&
      result.blocked === 0,
    "Unexpected worker outcome. Inspect saved receipts before another invocation.",
  );
  return {
    mode,
    authenticated: true,
    enabled: false,
    claimed: 0,
    prepared: 0,
    templates: 0,
    blocked: 0,
    receiptVerified: false,
    responseRecovered: false,
  };
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(await checkWorkbookWorker(process.env)));
  } catch {
    console.error(
      "Development workbook check refused or failed. Single-workbook prepare-test is retired. No automatic retry occurred.",
    );
    process.exitCode = 1;
  }
}
