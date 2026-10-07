import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { jsonRequest, requireCondition, target } from "./cutover-authority.mjs";

export function vercelReader(config, fetcher = fetch) {
  return (path, body, method) =>
    jsonRequest(
      `https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}teamId=${target.team}`,
      config.vercelToken,
      body ? { method: method || "POST", body: JSON.stringify(body) } : {},
      fetcher,
    );
}

export async function verifyProject(read) {
  const project = await read(`/v9/projects/${target.project}`);
  requireCondition(
    project.id === target.project &&
      project.accountId === target.team &&
      project.link?.type === "github" &&
      Number(project.link.repoId) === target.repositoryId &&
      project.link.productionBranch === "main",
    "The root Vercel project identity changed.",
  );
  let until = "";
  for (let page = 0; page < 10; page++) {
    const result = await read(
      `/v9/projects/${target.project}/domains?limit=100${until}`,
    );
    requireCondition(
      Array.isArray(result.domains),
      "Project domain inventory is unavailable.",
    );
    requireCondition(
      result.domains.every(
        (domain) =>
          ![target.branch, target.holdBranch].includes(domain.gitBranch) ||
          domain.name === target.domain,
      ),
      "Another project domain could be assigned by this Preview. Review that binding first.",
    );
    if (!result.pagination?.next) return;
    requireCondition(
      Number.isSafeInteger(result.pagination.next) &&
        result.pagination.next > 0,
      "Project domain pagination is invalid.",
    );
    until = `&until=${result.pagination.next}`;
  }
  requireCondition(
    false,
    "Project domain inventory exceeds the reviewed bound.",
  );
}

export async function readDomain(read, branch) {
  const domain = await read(
    `/v9/projects/${target.project}/domains/${target.domain}`,
  );
  requireCondition(
    domain.name === target.domain &&
      domain.verified === true &&
      domain.gitBranch === branch &&
      !domain.redirect &&
      !domain.customEnvironmentId,
    "The Development domain binding is not the expected branch without redirects.",
  );
  return domain;
}

export async function readAlias(read, allowed) {
  const alias = await read(`/v4/aliases/${target.domain}`);
  requireCondition(
    alias.alias === target.domain &&
      alias.projectId === target.project &&
      /^dpl_[A-Za-z0-9]+$/u.test(alias.deploymentId ?? "") &&
      (!allowed || allowed.includes(alias.deploymentId)),
    "Development alias ownership changed. Refusing to overwrite it.",
  );
  return alias.deploymentId;
}

export async function verifyNoCompetingDeployment(read, owned = []) {
  let until = "";
  for (let page = 0; page < 10; page++) {
    const result = await read(
      `/v6/deployments?projectId=${target.project}&limit=100&state=BUILDING,QUEUED,INITIALIZING${until}`,
    );
    requireCondition(
      Array.isArray(result.deployments),
      "Deployment inventory is unavailable.",
    );
    for (const deployment of result.deployments) {
      const branch =
        deployment.meta?.githubCommitRef || deployment.gitSource?.ref;
      const claimsDomain = (deployment.alias ?? []).includes(target.domain);
      const mayClaim =
        claimsDomain ||
        (deployment.target !== "production" &&
          (!branch ||
            branch === target.branch ||
            branch === target.holdBranch));
      requireCondition(
        !mayClaim || owned.includes(deployment.uid || deployment.id),
        "A competing Preview may assign the Development domain. Wait for it to settle.",
      );
    }
    if (!result.pagination?.next) return;
    requireCondition(
      Number.isSafeInteger(result.pagination.next) &&
        result.pagination.next > 0,
      "Deployment pagination is invalid.",
    );
    until = `&until=${result.pagination.next}`;
  }
  requireCondition(
    false,
    "Active deployment inventory exceeds the reviewed bound.",
  );
}

export async function holdDomain(read, priorAlias, owned = []) {
  await verifyProject(read);
  await readDomain(read, target.branch);
  await verifyNoCompetingDeployment(read, owned);
  await readAlias(read, [priorAlias]);
  await read(
    `/v9/projects/${target.project}/domains/${target.domain}`,
    { gitBranch: target.holdBranch },
    "PATCH",
  );
  await readDomain(read, target.holdBranch);
  await readAlias(read, [priorAlias]);
  await verifyNoCompetingDeployment(read, owned);
}

export async function verifyHeldAlias(read, allowed, owned = []) {
  await verifyProject(read);
  await readDomain(read, target.holdBranch);
  await verifyNoCompetingDeployment(read, owned);
  return readAlias(read, allowed);
}

export async function assignHeldAlias(
  read,
  deploymentId,
  expected,
  owned = [],
) {
  requireCondition(
    /^dpl_[A-Za-z0-9]+$/u.test(deploymentId),
    "Invalid target deployment.",
  );
  // The API has no conditional alias write. These checks do not serialize
  // unrelated privileged operators. Unexpected ownership stops recovery too.
  await verifyHeldAlias(read, expected, owned);
  await read(`/v2/deployments/${deploymentId}/aliases`, {
    alias: target.domain,
  });
  await readDomain(read, target.holdBranch);
  await readAlias(read, [deploymentId]);
}

export function maintenancePayload(config) {
  const directory = resolve(
    config.cwd,
    "scripts/production/maintenance-output",
  );
  const output = JSON.parse(
    readFileSync(resolve(directory, "config.json"), "utf8"),
  );
  requireCondition(
    output.version === 3 &&
      output.crons?.length === 0 &&
      Array.isArray(output.routes),
    "The reviewed static maintenance output is missing.",
  );
  const files = ["maintenance.html", "maintenance-api.json"].map((name) => ({
    file: name,
    data: readFileSync(resolve(directory, "static", name), "utf8"),
    encoding: "utf-8",
  }));
  files.push({
    file: "maintenance-health.txt",
    data: `lets-assist-development-maintenance:${config.candidate}:${config.run}\n`,
    encoding: "utf-8",
  });
  files.push({
    file: "vercel.json",
    data: JSON.stringify({ version: 2, routes: output.routes, crons: [] }),
    encoding: "utf-8",
  });
  return {
    name: "lets-assist",
    project: target.project,
    source: "cli",
    files,
    autoAssignCustomDomains: false,
    projectSettings: {
      framework: null,
      buildCommand: null,
      installCommand: null,
      outputDirectory: ".",
    },
    meta: {
      developmentCutover: "maintenance",
      developmentCandidate: config.candidate,
      developmentRun: config.run,
    },
  };
}

export function applicationPayload(config, sha) {
  const env = {
    LETS_ASSIST_EXPLICIT_DEVELOPMENT_SHA: sha,
    LETS_ASSIST_BUILD_SHA: sha,
    EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF: target.database,
    NEXT_PUBLIC_SUPABASE_URL: `https://${target.database}.supabase.co`,
    SUPABASE_URL: `https://${target.database}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: config.serverKey,
    SUPABASE_SECRET_KEY: config.serverKey,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: config.publicKey,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.publicKey,
    CSF_WORKER_CONTROL_MODE: "database",
    CSF_WORKBOOK_WORKER_ENABLED: "false",
    CSF_IMPORT_WORKER_ENABLED: "false",
    CSF_COMMUNICATIONS_WORKER_ENABLED: "false",
    CSF_SCHEDULED_POST_PUBLISHER_ENABLED: "false",
    CSF_PUBLICATION_NOTIFICATIONS_ENABLED: "false",
    CSF_SHEET_WRITEBACK_ENABLED: "false",
    CSF_OPERATIONAL_ALERTS_ENABLED: "false",
    PUBLIC_IMAGE_CLEANUP_ENABLED: "false",
    ORG_CALENDAR_SYNC_WORKER_ENABLED: "false",
    ORG_SHEET_SYNC_WORKER_ENABLED: "false",
    PROJECT_CANCELLATION_WORKER_ENABLED: "false",
    PROJECT_FEEDBACK_WORKER_ENABLED: "false",
    PAPER_SIGNUP_NOTIFICATION_WORKER_ENABLED: "false",
    AUTO_PUBLISH_ENABLED: "false",
  };
  return {
    name: "lets-assist",
    project: target.project,
    source: "cli",
    autoAssignCustomDomains: false,
    gitSource: {
      type: "github",
      repoId: String(target.repositoryId),
      ref: target.branch,
      sha,
    },
    env,
    build: { env },
    meta: {
      developmentCutover: "application",
      developmentCandidate: config.candidate,
      developmentRun: config.run,
    },
  };
}

export function validateDeployment(deployment, config, kind, sha, expectedId) {
  requireCondition(
    /^dpl_[A-Za-z0-9]+$/u.test(deployment?.id ?? "") &&
      /^[a-z0-9-]+\.vercel\.app$/u.test(deployment.url ?? "") &&
      deployment.target === null &&
      deployment.projectId === target.project &&
      deployment.meta?.developmentCutover === kind &&
      deployment.meta?.developmentCandidate === config.candidate &&
      deployment.meta?.developmentRun === config.run &&
      (!expectedId || deployment.id === expectedId) &&
      (kind === "maintenance" ||
        (deployment.gitSource?.sha === sha &&
          deployment.gitSource?.ref === target.branch &&
          Number(deployment.gitSource?.repoId) === target.repositoryId)),
    "Staged Preview identity differs from this cutover.",
  );
  if (kind === "application" && deployment.readyState === "READY") {
    requireCondition(
      deployment.meta.githubCommitSha === sha &&
        deployment.meta.githubCommitRef === target.branch,
      "Vercel's resolved application source differs from the approved Development merge.",
    );
  }
  requireCondition(
    Array.isArray(deployment.alias ?? []) &&
      (deployment.alias ?? []).every(
        (alias) =>
          typeof alias === "string" && /^[a-z0-9-]+\.vercel\.app$/u.test(alias),
      ),
    "A staged Preview unexpectedly received a custom domain.",
  );
  return { id: deployment.id, origin: `https://${deployment.url}` };
}

export async function createPreview(
  config,
  read,
  kind,
  sha,
  record,
  pause = (ms) => new Promise((resolvePause) => setTimeout(resolvePause, ms)),
) {
  const created = await read(
    "/v13/deployments",
    kind === "maintenance"
      ? maintenancePayload(config)
      : applicationPayload(config, sha),
  );
  const stage = validateDeployment(created, config, kind, sha);
  record(stage);
  return waitPreview(config, read, kind, sha, stage, pause);
}

export async function waitPreview(
  config,
  read,
  kind,
  sha,
  stage,
  pause = (ms) => new Promise((resolvePause) => setTimeout(resolvePause, ms)),
) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const current = await read(`/v13/deployments/${stage.id}`);
    validateDeployment(current, config, kind, sha, stage.id);
    if (current.readyState === "READY") return stage;
    requireCondition(
      ["QUEUED", "INITIALIZING", "BUILDING"].includes(current.readyState),
      "The recorded Preview did not become ready. Reconcile it before another run.",
    );
    await pause(15_000);
  }
  requireCondition(
    false,
    "The recorded Preview is still pending. Do not create a replacement blindly.",
  );
}

export async function refuseEarlierStage(config, read, kind, since) {
  let until = "";
  for (let page = 0; page < 10; page++) {
    const result = await read(
      `/v6/deployments?projectId=${target.project}&limit=100&since=${since}${until}`,
    );
    requireCondition(
      Array.isArray(result.deployments),
      "Cutover deployment history is unavailable.",
    );
    requireCondition(
      result.deployments.every(
        (deployment) =>
          deployment.meta?.developmentCandidate !== config.candidate ||
          deployment.meta?.developmentCutover !== kind,
      ),
      "A prior cutover deployment exists. Recover its recorded identity instead of creating another.",
    );
    if (!result.pagination?.next) return;
    requireCondition(
      Number.isSafeInteger(result.pagination.next) &&
        result.pagination.next > 0,
      "Cutover history pagination is invalid.",
    );
    until = `&until=${result.pagination.next}`;
  }
  requireCondition(false, "Cutover history exceeds its reviewed bound.");
}

export async function verifyMaintenancePage(
  config,
  stage,
  fetcher = fetch,
  alias = false,
) {
  const origin = alias ? `https://${target.domain}` : stage.origin;
  requireCondition(
    origin === `https://${target.domain}` ||
      /^https:\/\/[a-z0-9-]+\.vercel\.app$/u.test(origin),
    "Invalid health origin.",
  );
  const response = await fetcher(`${origin}/maintenance-health.txt`, {
    headers: { "x-vercel-protection-bypass": config.bypass },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  requireCondition(
    response.ok &&
      (await response.text()).trim() ===
        `lets-assist-development-maintenance:${config.candidate}:${config.run}`,
    "The maintenance page does not match its recorded candidate and run.",
  );
}

export async function verifyApplicationPage(
  config,
  stage,
  sha,
  fetcher = fetch,
  alias = false,
) {
  const origin = alias ? `https://${target.domain}` : stage.origin;
  requireCondition(
    origin === `https://${target.domain}` ||
      /^https:\/\/[a-z0-9-]+\.vercel\.app$/u.test(origin),
    "Invalid application origin.",
  );
  const response = await fetcher(`${origin}/api/status?deep=0`, {
    headers: { "x-vercel-protection-bypass": config.bypass },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    /* Refuse below. */
  }
  const workers = payload?.checks?.filter((row) => row.name === "workers");
  const controls = workers?.[0]?.details;
  requireCondition(
    response.ok &&
      payload.service === "lets-assist" &&
      payload.environment === "preview" &&
      payload.version === sha &&
      payload.deep === false &&
      workers.length === 1 &&
      controls.csfControlMode === "database" &&
      [
        "csfWorkbookRefresh",
        "csfImportCommit",
        "csfCommunications",
        "csfScheduledPostPublisher",
        "csfPublicationNotifications",
        "autoPublishHours",
        "organizationCalendarSync",
        "organizationSheetSync",
        "projectCancellationWorker",
        "publicImageCleanup",
        "csfOperationalAlerts",
      ].every((key) => controls[key] === false),
    "The staged application identity or disabled worker posture is unverified.",
  );
}
