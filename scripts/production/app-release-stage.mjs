import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  ReleaseCheckError,
  requireSha,
  safeFailureMessage,
} from "./app-release-checks.mjs";

const workers = [
  "CSF_WORKBOOK_WORKER_ENABLED",
  "CSF_IMPORT_WORKER_ENABLED",
  "CSF_COMMUNICATIONS_WORKER_ENABLED",
  "CSF_SCHEDULED_POST_PUBLISHER_ENABLED",
];

export function stageConfig(env) {
  const config = {
    release: requireSha(env.RELEASE_SHA),
    accepted: requireSha(env.ACCEPTED_SHA),
    controller: requireSha(env.GITHUB_SHA),
    project: env.VERCEL_ROOT_PROJECT_ID,
    team: env.VERCEL_TEAM_ID,
    repository: env.EXPECTED_GITHUB_REPOSITORY_ID,
    token: env.VERCEL_TOKEN,
    run: env.GITHUB_RUN_ID,
  };
  if (
    !/^prj_[A-Za-z0-9]+$/u.test(config.project ?? "") ||
    !/^team_[A-Za-z0-9]+$/u.test(config.team ?? "") ||
    !/^[1-9][0-9]*$/u.test(config.repository ?? "") ||
    !/^[1-9][0-9]*$/u.test(config.run ?? "") ||
    !config.token
  ) {
    throw new ReleaseCheckError(
      "Missing or invalid staged release configuration.",
    );
  }
  return config;
}

export function stagePayload(config) {
  const env = Object.fromEntries(workers.map((key) => [key, "false"]));
  env.LETS_ASSIST_BUILD_SHA = config.release;
  env.LETS_ASSIST_EXPLICIT_RELEASE_SHA = config.release;
  env.CSF_WORKER_CONTROL_MODE = "database";
  return {
    name: "lets-assist",
    project: config.project,
    target: "production",
    source: "cli",
    gitSource: {
      type: "github",
      repoId: config.repository,
      ref: config.release,
      sha: config.release,
    },
    autoAssignCustomDomains: false,
    env,
    build: { env: { ...env } },
    meta: { appOnlyReleaseSha: config.release, appOnlyReleaseRun: config.run },
  };
}

async function providerRequest(config, path, options, fetcher) {
  let response;
  try {
    response = await fetcher(
      `https://api.vercel.com${path}?teamId=${config.team}`,
      {
        ...options,
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch {
    throw new ReleaseCheckError(
      "Staging request outcome is unknown. Inspect the release run metadata before creating another deployment.",
    );
  }
  if (!response.ok)
    throw new ReleaseCheckError(
      `Staging provider refused HTTP ${response.status}. No response body was logged.`,
    );
  try {
    return await response.json();
  } catch {
    throw new ReleaseCheckError(
      "Staging response was unreadable. Reconcile the release run before retrying.",
    );
  }
}

export function validateStage(deployment, config, expectedId) {
  if (
    !/^dpl_[A-Za-z0-9]+$/u.test(deployment?.id ?? "") ||
    !/^[a-z0-9-]+\.vercel\.app$/u.test(deployment?.url ?? "") ||
    deployment.target !== "production" ||
    deployment.projectId !== config.project ||
    deployment.meta?.appOnlyReleaseSha !== config.release ||
    deployment.meta?.appOnlyReleaseRun !== config.run ||
    deployment.gitSource?.sha !== config.release ||
    String(deployment.gitSource?.repoId) !== config.repository ||
    (expectedId && deployment.id !== expectedId)
  ) {
    throw new ReleaseCheckError(
      "Staged deployment identity does not match the accepted release.",
    );
  }
  const aliases = deployment.alias ?? [];
  if (
    deployment.aliasAssigned === true ||
    deployment.aliasAssigned === "true" ||
    !Array.isArray(aliases) ||
    aliases.some(
      (alias) => typeof alias !== "string" || alias === "lets-assist.com",
    )
  ) {
    throw new ReleaseCheckError(
      "Staged deployment unexpectedly has a Production alias. Stop and reconcile.",
    );
  }
  return { deployment_id: deployment.id, origin: `https://${deployment.url}` };
}

export async function createStage(config, fetcher = fetch) {
  // Do not retry this POST. A lost response may still have created the build.
  const deployment = await providerRequest(
    config,
    "/v13/deployments",
    {
      method: "POST",
      body: JSON.stringify(stagePayload(config)),
    },
    fetcher,
  );
  return validateStage(deployment, config);
}

export async function waitForStage(
  config,
  id,
  fetcher = fetch,
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  if (!/^dpl_[A-Za-z0-9]+$/u.test(id ?? ""))
    throw new ReleaseCheckError("Invalid staged deployment ID.");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const deployment = await providerRequest(
      config,
      `/v13/deployments/${id}`,
      { method: "GET" },
      fetcher,
    );
    validateStage(deployment, config, id);
    if (deployment.readyState === "READY") return;
    if (
      !["QUEUED", "INITIALIZING", "BUILDING"].includes(deployment.readyState)
    ) {
      throw new ReleaseCheckError(
        "Staged build did not reach READY. Inspect the existing deployment; do not rebuild automatically.",
      );
    }
    await pause(15_000);
  }
  throw new ReleaseCheckError(
    "Staged build is still pending. Reuse its recorded deployment ID.",
  );
}

async function main() {
  const config = stageConfig(process.env);
  if (process.argv[2] === "wait") {
    await waitForStage(config, process.env.STAGED_DEPLOYMENT_ID);
    console.log(
      "The exact staged Production build is READY; no domain was promoted.",
    );
    return;
  }
  if (process.argv[2] !== "create")
    throw new ReleaseCheckError("Choose create or wait.");
  const staged = await createStage(config);
  mkdirSync(".artifacts", { recursive: true });
  writeFileSync(
    ".artifacts/app-only-stage.json",
    JSON.stringify(
      {
        ...staged,
        release: config.release,
        accepted: config.accepted,
        controller: config.controller,
        run: config.run,
      },
      null,
      2,
    ),
  );
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `deployment_id=${staged.deployment_id}\norigin=${staged.origin}\n`,
  );
  console.log(
    `Created staged deployment ${staged.deployment_id}. No second build will be started by this run.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(safeFailureMessage(error));
    process.exitCode = 1;
  });
}
