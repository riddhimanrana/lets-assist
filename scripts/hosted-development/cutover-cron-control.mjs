import {
  cutoverFailureMessage,
  isSha,
  loadPreparation,
  requireCondition,
  target,
  verifyAuthority,
} from "./cutover-authority.mjs";
import {
  developmentQuery,
  inspectDevelopmentDatabase,
  validateDatabaseUrl,
  probeWriteBlock,
} from "./cutover-database.mjs";
import { probeReadAvailability } from "./cutover-bootstrap.mjs";
import { readAlias, readDomain, verifyProject } from "./cutover-vercel.mjs";
import {
  development729Digest,
  developmentCronChangeSql,
  readDevelopmentCronSnapshot,
  reviewedDevelopmentCronLedger,
  validateDevelopmentCronJobs,
} from "./cutover-cron-control-sql.mjs";

const equalJobs = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function validateCronPauseReceipt(receipt, config, now = Date.now()) {
  requireCondition(
    config.phase === "resume-cron" &&
      receipt?.format === 1 &&
      receipt.kind === "development-cron-pause" &&
      ["cron-pause-started", "cron-paused", "cron-pause-unproven"].includes(
        receipt.phase,
      ) &&
      receipt.candidate === config.candidate &&
      receipt.controller === config.candidate &&
      receipt.run === config.prepareRun &&
      receipt.pr === config.pr &&
      receipt.project === target.project &&
      receipt.team === target.team &&
      receipt.database === target.database &&
      receipt.domain === target.domain &&
      receipt.holdBranch === target.holdBranch &&
      isSha(receipt.base) &&
      isSha(receipt.tree) &&
      /^dpl_[A-Za-z0-9]+$/u.test(receipt.priorAlias ?? "") &&
      receipt.schema?.count === 729 &&
      receipt.schema.digest === development729Digest &&
      Number.isSafeInteger(receipt.createdAt) &&
      receipt.createdAt <= now &&
      Number.isSafeInteger(receipt.expiresAt) &&
      receipt.expiresAt > receipt.createdAt &&
      receipt.expiresAt - receipt.createdAt <= 4 * 60 * 60 * 1000 &&
      receipt.externalWriters ===
        "operator-attested-stopped-in-protected-environment",
    "Cron restoration requires the original immutable pause receipt for this exact Development candidate.",
  );
  validateDevelopmentCronJobs(receipt.cronBefore);
}

export async function runDevelopmentCronControl(config, dependencies) {
  const { github, vercel, record, now, fetcher } = dependencies;
  const query = dependencies.query || developmentQuery;
  const wait =
    dependencies.wait ||
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const pause = config.phase === "pause-cron";
  requireCondition(
    pause || config.phase === "resume-cron",
    "Unknown cron control operation.",
  );
  validateDatabaseUrl(config.databaseUrl);
  const source = await verifyAuthority(config, github);
  const original = pause
    ? null
    : await (dependencies.loadReceipt || loadPreparation)(
        config,
        github,
        fetcher,
        now(),
        validateCronPauseReceipt,
      );
  if (original) {
    validateCronPauseReceipt(original, config, now());
    requireCondition(
      original.base === source.base && original.tree === source.tree,
      "Development changed since cron shutdown; restoration is refused.",
    );
  }
  const verifyApplication = async () => {
    const freshSource = await verifyAuthority(config, github);
    requireCondition(
      freshSource.base === source.base && freshSource.tree === source.tree,
      "Development source changed during cron control.",
    );
    await verifyProject(vercel);
    await readDomain(vercel, target.branch);
    const alias = await readAlias(vercel);
    if (original)
      requireCondition(
        alias === original.priorAlias,
        "The Development alias changed after cron shutdown.",
      );
    const deployment = await vercel(`/v13/deployments/${alias}`);
    requireCondition(
      deployment.projectId === target.project &&
        deployment.target === null &&
        deployment.meta?.githubCommitSha === source.base &&
        deployment.meta?.githubCommitRef === target.branch,
      "Cron control requires the unchanged current Development application.",
    );
    return alias;
  };
  const priorAlias = await verifyApplication();
  const versions = reviewedDevelopmentCronLedger(config, query);
  const schema = inspectDevelopmentDatabase(config, query);
  requireCondition(
    schema.posture.enabledControlRows === 0 &&
      schema.posture.publicationLeases === 0,
    "Stop CSF workers and drain publication leases before cron control.",
  );
  const before = readDevelopmentCronSnapshot(config, query);
  if (!pause)
    requireCondition(
      before.runningCron === 0,
      "Running cron work must settle before restoration.",
    );
  const originalJobs = original?.cronBefore || before.jobs;
  const after = pause
    ? before.jobs.map((job) => ({ ...job, active: false }))
    : originalJobs;
  requireCondition(
    pause ||
      equalJobs(before.jobs, originalJobs) ||
      equalJobs(
        before.jobs,
        originalJobs.map((job) => ({ ...job, active: false })),
      ),
    "Cron flags or identities changed since shutdown; do not overwrite another operator.",
  );
  await probeReadAvailability(config, fetcher);
  await probeWriteBlock(config, fetcher, false);
  const receipt = {
    format: 1,
    kind: pause ? "development-cron-pause" : "development-cron-resume",
    ...source,
    candidate: config.candidate,
    controller: config.controller,
    run: config.run,
    observer: config.actor,
    project: target.project,
    team: target.team,
    database: target.database,
    domain: target.domain,
    holdBranch: target.holdBranch,
    priorAlias,
    createdAt: now(),
    expiresAt: now() + 4 * 60 * 60 * 1000,
    phase: pause ? "cron-pause-started" : "cron-resume-started",
    pauseRun: original?.run,
    schema,
    cronBefore: originalJobs,
    externalWriters: "operator-attested-stopped-in-protected-environment",
    maintenanceReady: false,
    aliasChanged: false,
    requestGuardChanged: false,
  };
  record(receipt);
  try {
    await verifyApplication();
    const fresh = readDevelopmentCronSnapshot(config, query);
    requireCondition(
      equalJobs(fresh.jobs, before.jobs),
      "Cron state changed before mutation.",
    );
    if (!equalJobs(before.jobs, after)) {
      const operation = pause ? "pause" : "resume";
      requireCondition(
        query(
          config.databaseUrl,
          developmentCronChangeSql(versions, before.jobs, after, operation),
        ) === `development-cron-${operation}-committed`,
        "Development cron operation is unproven. Reconcile its receipt before another mutation.",
      );
    }
    const deadline = now() + 60_000;
    let post;
    for (let attempt = 0; attempt < 30; attempt++) {
      post = readDevelopmentCronSnapshot(config, query);
      requireCondition(
        equalJobs(post.jobs, after),
        "Fresh cron readback differs from the intended active flags.",
      );
      if (!pause || post.runningCron === 0) break;
      requireCondition(
        attempt < 29 && now() < deadline,
        "Cron jobs are paused but running work has not drained.",
      );
      await wait(1_000);
    }
    receipt.schema = inspectDevelopmentDatabase(config, query);
    requireCondition(
      !pause || receipt.schema.databaseQuiescent,
      "Paused jobs do not prove Development quiescence.",
    );
    await verifyApplication();
    receipt.cronAfter = post.jobs;
    receipt.phase = pause ? "cron-paused" : "cron-resumed";
    receipt.restoration = pause
      ? "original-active-flags-retained-for-preparation-abort"
      : "exact-original-active-flags-verified-before-preparation";
    record(receipt);
    return receipt;
  } catch (error) {
    receipt.phase = pause ? "cron-pause-unproven" : "cron-resume-unproven";
    receipt.failure = cutoverFailureMessage(error);
    record(receipt);
    throw error;
  }
}
