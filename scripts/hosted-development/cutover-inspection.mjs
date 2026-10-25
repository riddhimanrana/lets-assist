import {
  cutoverFailureMessage,
  requireCondition,
  target,
  verifyAuthority,
} from "./cutover-authority.mjs";
import { inspectDevelopmentDatabase } from "./cutover-database.mjs";
import { probeReadAvailability } from "./cutover-bootstrap.mjs";
import { readAlias, readDomain, verifyProject } from "./cutover-vercel.mjs";

const workerKeys = [
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
];

async function inspectWorkerPosture(config, sha, fetcher) {
  const response = await fetcher(`https://${target.domain}/api/status?deep=0`, {
    method: "GET",
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
  const checks = Array.isArray(payload?.checks)
    ? payload.checks.filter((check) => check.name === "workers")
    : [];
  const details = checks[0]?.details;
  requireCondition(
    response.ok &&
      payload?.service === "lets-assist" &&
      payload.environment === "preview" &&
      payload.version === sha &&
      payload.deep === false &&
      checks.length === 1 &&
      ["database", "environment"].includes(details?.csfControlMode) &&
      workerKeys.every((key) => typeof details[key] === "boolean"),
    "The current Development application worker status is unverified.",
  );
  // Inventory may report enabled workers. It never establishes a writer hold.
  // Retain only this nonsecret projection, never headers or arbitrary payload fields.
  return {
    version: payload.version,
    controlMode: details.csfControlMode,
    workers: Object.fromEntries(workerKeys.map((key) => [key, details[key]])),
  };
}

/** Protected provider/database inspection. This path has no mutation transport. */
export async function runDevelopmentInspection(
  config,
  { github, vercel, query, record, now, fetcher },
) {
  const receipt = {
    format: 1,
    phase: "inspection-started",
    readOnly: true,
    candidate: config.candidate,
    controller: config.controller,
    run: config.run,
    observer: config.actor,
    project: target.project,
    team: target.team,
    database: target.database,
    domain: target.domain,
    createdAt: now(),
    maintenanceReady: false,
    externalWriters: "not-attested",
    hostedAcceptance: "not-run-inspection-only",
  };
  record(receipt);
  try {
    Object.assign(receipt, await verifyAuthority(config, github));
    await verifyProject(vercel);
    await readDomain(vercel, target.branch);
    receipt.priorAlias = await readAlias(vercel);
    const deployment = await vercel(`/v13/deployments/${receipt.priorAlias}`);
    requireCondition(
      deployment.projectId === target.project &&
        deployment.target === null &&
        deployment.meta?.githubCommitSha === receipt.base &&
        deployment.meta?.githubCommitRef === target.branch,
      "The inspected Development alias must serve the current Development head.",
    );
    receipt.schema = inspectDevelopmentDatabase(config, query);
    receipt.applicationWorkerPosture = await inspectWorkerPosture(
      config,
      receipt.base,
      fetcher,
    );
    await probeReadAvailability(config, fetcher);
    await verifyAuthority(config, github);
    receipt.phase = "inspected";
    record(receipt);
    return receipt;
  } catch (error) {
    receipt.phase = "inspection-stopped";
    receipt.failure = cutoverFailureMessage(error);
    record(receipt);
    throw error;
  }
}
