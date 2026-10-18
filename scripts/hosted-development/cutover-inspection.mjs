import {
  cutoverFailureMessage,
  requireCondition,
  target,
  verifyAuthority,
} from "./cutover-authority.mjs";
import { inspectDevelopmentDatabase } from "./cutover-database.mjs";
import { probeReadAvailability } from "./cutover-bootstrap.mjs";
import { readAlias, readDomain, verifyProject } from "./cutover-vercel.mjs";

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
