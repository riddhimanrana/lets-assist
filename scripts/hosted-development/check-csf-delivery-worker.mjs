const APP_ORIGIN = "https://dev.lets-assist.com";
const DATABASE_ORIGIN = "https://ocbuygudvarsuxijxhau.supabase.co";
const FIXTURE_ORG = "c5f11000-0000-4000-8000-000000000001";
const TEST_ADDRESS = /^delivered\+csf-sep07-(0[1-9]|10)@resend\.dev$/u;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateTestQueue({
  campaignId,
  campaigns,
  recipients,
  attempts,
}) {
  requireCondition(
    campaigns.length === 1 &&
      campaigns[0].id === campaignId &&
      campaigns[0].organization_id === FIXTURE_ORG &&
      campaigns[0].status === "queued",
    "The Development queue is not restricted to the test campaign.",
  );
  requireCondition(
    recipients.length === 10 &&
      new Set(recipients.map((row) => row.normalized_recipient_email)).size ===
        10 &&
      recipients.every(
        (row) =>
          row.campaign_id === campaignId &&
          row.organization_id === FIXTURE_ORG &&
          row.subscription_decision === "included" &&
          TEST_ADDRESS.test(row.normalized_recipient_email),
      ),
    "The campaign must contain exactly the ten approved test recipients.",
  );
  const recipientIds = new Set(recipients.map((row) => row.id));
  requireCondition(
    attempts.length === 10 &&
      new Set(attempts.map((row) => row.recipient_snapshot_id)).size === 10 &&
      attempts.every(
        (row) =>
          row.campaign_id === campaignId &&
          row.organization_id === FIXTURE_ORG &&
          row.state === "queued" &&
          row.attempt_number === 1 &&
          !row.provider_message_id &&
          !row.dispatch_authorized_at &&
          recipientIds.has(row.recipient_snapshot_id),
      ),
    "Dispatch requires ten untouched first attempts and no unrelated active attempts.",
  );
}

/** @param {Record<string, string | undefined>} env
 * @param {(url: string, options: RequestInit) => Promise<Response>} fetchImpl */
export async function checkDeliveryWorker(env, fetchImpl = fetch) {
  const mode = env.CSF_DELIVERY_CHECK_MODE;
  const sha = env.ACCEPTED_SHA;
  requireCondition(
    ["verify-disabled", "dispatch-test"].includes(mode),
    "Invalid delivery check mode.",
  );
  requireCondition(
    /^[a-f0-9]{40}$/u.test(sha ?? ""),
    "An exact Development SHA is required.",
  );
  requireCondition(
    env.SUPABASE_URL === DATABASE_ORIGIN,
    "Only the fixed Development backend is permitted.",
  );
  requireCondition(
    env.CSF_DELIVERY_CONFIRMATION === `${mode}:ocbuygudvarsuxijxhau`,
    "Development confirmation does not match.",
  );
  for (const key of [
    "SUPABASE_SERVICE_ROLE_KEY",
    "CSF_COMMUNICATIONS_WORKER_SECRET_TOKEN",
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
      signal: AbortSignal.timeout(180_000),
    });
    requireCondition(
      response.ok,
      "A Development verification request failed. No automatic retry was made.",
    );
    return response.json();
  };
  const databaseHeaders = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
  };
  const appHeaders = {
    "x-vercel-protection-bypass": env.VERCEL_AUTOMATION_BYPASS_SECRET,
    "cache-control": "no-cache",
  };
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
      posture.csfWorkbookRefresh === false &&
      posture.csfImportCommit === false &&
      posture.csfScheduledPostPublisher === false &&
      posture.csfCommunications === (mode === "dispatch-test"),
    "Development is not serving the requested release and effective worker posture.",
  );
  const controls = await readJson(
    `${DATABASE_ORIGIN}/rest/v1/rpc/read_csf_release_worker_controls`,
    {
      method: "POST",
      headers: databaseHeaders,
      body: JSON.stringify({ p_release_sha: sha }),
    },
  );
  requireCondition(
    controls.releaseSha === sha &&
      controls.workers &&
      controls.workers.workbook_refresh === false &&
      controls.workers.import_commit === false &&
      controls.workers.scheduled_post_publisher === false &&
      controls.workers.communications === (mode === "dispatch-test"),
    "Development worker controls do not match the requested check.",
  );
  if (mode === "dispatch-test") {
    const campaignId = env.CSF_TEST_CAMPAIGN_ID;
    requireCondition(
      /^[a-f0-9-]{36}$/u.test(campaignId ?? ""),
      "A test campaign receipt is required.",
    );
    const readTable = (table, query) =>
      readJson(`${DATABASE_ORIGIN}/rest/v1/${table}?${query}`, {
        headers: { ...databaseHeaders, "accept-profile": "plugin_data" },
      });
    const [campaigns, recipients, attempts] = await Promise.all([
      readTable(
        "csf_communication_campaigns",
        "select=id,organization_id,status&status=in.(queued,sending)&limit=2",
      ),
      readTable(
        "csf_communication_recipient_snapshots",
        `select=id,campaign_id,organization_id,normalized_recipient_email,subscription_decision&campaign_id=eq.${campaignId}&limit=11`,
      ),
      readTable(
        "csf_communication_dispatch_attempts",
        `select=campaign_id,organization_id,recipient_snapshot_id,state,attempt_number,provider_message_id,dispatch_authorized_at&or=(state.in.(queued,processing),campaign_id.eq.${campaignId})&limit=11`,
      ),
    ]);
    validateTestQueue({ campaignId, campaigns, recipients, attempts });
  }
  const result = await readJson(
    `${APP_ORIGIN}/api/cron/csf-communications-dispatch`,
    {
      method: "POST",
      headers: {
        ...appHeaders,
        authorization: `Bearer ${env.CSF_COMMUNICATIONS_WORKER_SECRET_TOKEN}`,
      },
    },
  );
  requireCondition(
    result.enabled === (mode === "dispatch-test") &&
      result.claimed === (mode === "dispatch-test" ? 10 : 0) &&
      result.faults === 0,
    "The worker returned an unexpected outcome. Inspect receipts before another invocation.",
  );
  return {
    mode,
    authenticated: true,
    enabled: result.enabled,
    claimed: result.claimed,
    faults: Number.isInteger(result.faults) ? result.faults : null,
  };
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(await checkDeliveryWorker(process.env)));
  } catch {
    console.error(
      "Development worker check failed. Inspect the count-only receipts before retrying. No automatic retry occurred.",
    );
    process.exitCode = 1;
  }
}
