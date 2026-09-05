import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  productionRef,
  readJson,
  requireSha,
  ReleaseCheckError,
  safeFailureMessage,
} from "./app-release-checks.mjs";

const workerFields = {
  workbook_refresh: "csfWorkbookRefresh",
  import_commit: "csfImportCommit",
  communications: "csfCommunications",
  scheduled_post_publisher: "csfScheduledPostPublisher",
};
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;

export function transitionConfig(env) {
  const sha = requireSha(env.RELEASE_SHA);
  const enabled = env.WORKER_ENABLED === "true";
  if (
    !Object.hasOwn(workerFields, env.WORKER ?? "") ||
    !["true", "false"].includes(env.WORKER_ENABLED) ||
    env.SUPABASE_PROJECT_ID !== productionRef ||
    !env.SUPABASE_ACCESS_TOKEN ||
    !/^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ID ?? "") ||
    env.GITHUB_RUN_ATTEMPT !== "1" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/u.test(env.GITHUB_ACTOR ?? "") ||
    env.CONFIRMATION !==
      `${enabled ? "enable" : "disable"}-csf-worker:${env.WORKER}:${sha}`
  ) {
    throw new ReleaseCheckError("Worker transition configuration is invalid.");
  }
  const hex = createHash("sha256")
    .update(`csf-worker:${env.GITHUB_RUN_ID}`)
    .digest("hex");
  const requestId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  return {
    sha,
    enabled,
    worker: env.WORKER,
    requestId,
    actor: `github:${env.GITHUB_ACTOR}`,
    token: env.SUPABASE_ACCESS_TOKEN,
  };
}

export function validateControls(data, sha) {
  if (
    data?.releaseSha !== sha ||
    !Number.isSafeInteger(data?.revision) ||
    data.revision < 0 ||
    !data.workers ||
    Object.keys(data.workers).length !== 4 ||
    Object.keys(workerFields).some(
      (worker) => typeof data.workers[worker] !== "boolean",
    )
  ) {
    throw new ReleaseCheckError("Worker controls returned invalid data.");
  }
  return data;
}

export function validatePublicPosture(payload, config, controls) {
  const checks = Array.isArray(payload?.checks)
    ? payload.checks.filter((item) => item.name === "workers")
    : [];
  const details = checks.length === 1 ? checks[0].details : null;
  if (
    payload?.version !== config.sha ||
    payload?.environment !== "production" ||
    payload?.deep !== false ||
    !["pass", "warn"].includes(checks[0]?.state) ||
    details?.csfControlMode !== "database" ||
    Object.entries(workerFields).some(
      ([worker, field]) => details?.[field] !== controls.workers[worker],
    )
  ) {
    throw new ReleaseCheckError(
      "Public release and runtime switches do not match. No new transition is safe.",
    );
  }
}

export async function transitionWorker(
  config,
  fetcher = fetch,
  record = () => {},
) {
  const query = async (sql, readOnly) => {
    const result = await readJson(
      `https://api.supabase.com/v1/projects/${productionRef}/database/query${readOnly ? "/read-only" : ""}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      },
      fetcher,
    );
    if (!Array.isArray(result) || result.length !== 1)
      throw new ReleaseCheckError("Worker query returned an invalid receipt.");
    return result[0];
  };
  const publicStatus = () =>
    readJson(
      `https://lets-assist.com/api/status?deep=0&worker_gate=${config.requestId}`,
      {
        method: "GET",
        headers: { "Cache-Control": "no-cache" },
      },
      fetcher,
    );
  const readControls = async () =>
    validateControls(
      (
        await query(
          `SELECT public.read_csf_release_worker_controls(${literal(config.sha)}) AS controls`,
          true,
        )
      ).controls,
      config.sha,
    );
  const before = await readControls();
  validatePublicPosture(await publicStatus(), config, before);
  const request = {
    releaseSha: config.sha,
    worker: config.worker,
    enabled: config.enabled,
    expectedRevision: before.revision,
    actor: config.actor,
    reason: "Authorized Production worker transition",
  };
  record({ requestId: config.requestId, request, state: "prepared" });
  let receipt;
  try {
    receipt = (
      await query(
        `SELECT app_private.set_csf_release_worker_control(${literal(config.sha)},${literal(config.worker)},${config.enabled},${before.revision},${literal(config.requestId)}::uuid,${literal(config.actor)},${literal(request.reason)}) AS receipt`,
        false,
      )
    ).receipt;
  } catch {
    // A lost response never repeats a mutation. Read its committed receipt.
    const recovered = await query(
      `SELECT request, result AS receipt FROM app_private.csf_release_worker_receipts WHERE request_id = ${literal(config.requestId)}::uuid`,
      true,
    );
    if (
      Object.keys(request).some(
        (key) => recovered.request?.[key] !== request[key],
      )
    )
      throw new ReleaseCheckError(
        "Worker outcome needs operator reconciliation.",
      );
    receipt = recovered.receipt;
  }
  validateControls(receipt, config.sha);
  if (
    receipt.requestId !== config.requestId ||
    receipt.revision !== before.revision + 1 ||
    Object.keys(workerFields).some(
      (worker) =>
        receipt.workers[worker] !==
        (worker === config.worker ? config.enabled : before.workers[worker]),
    )
  ) {
    throw new ReleaseCheckError(
      "Worker receipt does not match the frozen transition.",
    );
  }
  record({ requestId: config.requestId, request, receipt, state: "committed" });
  const current = await readControls();
  if (current.revision !== receipt.revision)
    throw new ReleaseCheckError(
      "Worker controls changed after the transition.",
    );
  validatePublicPosture(await publicStatus(), config, receipt);
  record({ requestId: config.requestId, request, receipt, state: "verified" });
  return receipt;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  Promise.resolve()
    .then(() =>
      transitionWorker(transitionConfig(process.env), fetch, (receipt) => {
        mkdirSync(".artifacts", { recursive: true });
        writeFileSync(
          ".artifacts/worker-transition.json",
          JSON.stringify(receipt, null, 2),
        );
      }),
    )
    .then(() =>
      console.log(
        "Production worker transition and public status verified. No app build was created.",
      ),
    )
    .catch((error) => {
      console.error(safeFailureMessage(error));
      process.exitCode = 1;
    });
}
