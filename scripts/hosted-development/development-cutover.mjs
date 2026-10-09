import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { maintenanceTarget } from "../production/maintenance-preflight.mjs";
import { ledgerDigest } from "../production/final-schema-manifest.mjs";
import { pauseBootstrapCron } from "./cutover-cron.mjs";
import {
  bootstrapPlan,
  bootstrapWriteFence,
  probeReadAvailability,
} from "./cutover-bootstrap.mjs";
import {
  cutoverConfig,
  githubReader,
  loadPreparation,
  requireCondition,
  target,
  verifyAuthority,
} from "./cutover-authority.mjs";
import {
  probeWriteBlock,
  setRetentionJob,
  setWriteBlock,
  settlePreexistingRequests,
  validateDatabaseUrl,
  verifyDevelopmentMaintenance,
  verifyQuiescence,
} from "./cutover-database.mjs";
import {
  assignHeldAlias,
  createPreview,
  holdDomain,
  readAlias,
  readDomain,
  refuseEarlierStage,
  verifyApplicationPage,
  verifyHeldAlias,
  verifyMaintenancePage,
  verifyNoCompetingDeployment,
  verifyProject,
  vercelReader,
  waitPreview,
} from "./cutover-vercel.mjs";

export function receiptWriter(cwd) {
  const directory = resolve(cwd, ".artifacts/development-cutover");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return (receipt) => {
    const path = resolve(directory, "development-cutover.json");
    writeFileSync(`${path}.pending`, `${JSON.stringify(receipt, null, 2)}\n`, {
      mode: 0o600,
    });
    renameSync(`${path}.pending`, path);
  };
}

export async function runDevelopmentCutover(config, dependencies = {}) {
  const fetcher = dependencies.fetcher || fetch;
  const github = dependencies.github || githubReader(config, fetcher);
  const vercel = dependencies.vercel || vercelReader(config, fetcher);
  const record = dependencies.record || receiptWriter(config.cwd);
  const query = dependencies.query;
  const now = dependencies.now || Date.now;
  validateDatabaseUrl(config.databaseUrl);
  const expectedDigest = ledgerDigest(
    config.phase === "bootstrap"
      ? bootstrapPlan(config.cwd).after
      : maintenanceTarget(config.cwd),
  );
  let receipt = ["bootstrap", "prepare"].includes(config.phase)
    ? undefined
    : await (dependencies.loadReceipt || loadPreparation)(
        config,
        github,
        fetcher,
        now(),
      );
  const authority = () => {
    requireCondition(
      config.phase === "recover" || !receipt || receipt.expiresAt > now(),
      "Cutover approval expired.",
    );
    return verifyAuthority(config, github, receipt, {
      recovery: config.phase === "recover",
    });
  };
  const source = await authority();
  await verifyProject(vercel);
  const owned = () =>
    [receipt?.maintenance?.id, receipt?.application?.id].filter(Boolean);
  const maintenanceConfig = () => ({ ...config, run: receipt.maintenanceRun });
  const persist = (phase) => {
    receipt.phase = phase;
    record(receipt);
  };
  if (config.phase === "bootstrap") {
    receipt = {
      format: 1,
      ...source,
      candidate: config.candidate,
      controller: config.controller,
      run: config.run,
      observer: config.actor,
      database: target.database,
      targetDigest: expectedDigest,
      externalWriters: "operator-attested-stopped-in-protected-environment",
      createdAt: now(),
      expiresAt: now() + 4 * 60 * 60 * 1000,
    };
    await authority();
    persist("bootstrap-started");
    try {
      pauseBootstrapCron(config, query);
      receipt.cron = "reviewed-baseline-jobs-paused";
      persist("bootstrap-cron-paused");
      verifyQuiescence(config, query);
      receipt.schema = bootstrapWriteFence(config, query);
      await probeReadAvailability(config, fetcher);
      await probeWriteBlock(config, fetcher, false);
      await authority();
      persist("bootstrapped");
      return receipt;
    } catch (error) {
      // An unknown outcome never authorizes removing an applied ledger entry.
      persist("bootstrap-unproven");
      throw error;
    }
  }
  const recover = async () => {
    await verifyAuthority(config, github, receipt, { recovery: true });
    const failures = [];
    try {
      setWriteBlock(config, true, query);
    } catch {
      failures.push("guard");
    }
    try {
      if (receipt.retentionRestored) setRetentionJob(config, false, query);
    } catch {
      failures.push("retention");
    }
    try {
      await probeWriteBlock(config, fetcher);
      settlePreexistingRequests(config, query);
    } catch {
      failures.push("probe");
    }
    requireCondition(
      failures.length === 0,
      "Development recovery write or scheduler hold is unproven.",
    );
    // Restore the fixed database fence even if another operator moved the
    // alias. An unrelated alias still prevents any domain overwrite.
    await verifyHeldAlias(vercel, [receipt.priorAlias, ...owned()], owned());
    await verifyMaintenancePage(
      maintenanceConfig(),
      receipt.maintenance,
      fetcher,
    );
    await assignHeldAlias(
      vercel,
      receipt.maintenance.id,
      [receipt.priorAlias, ...owned()],
      owned(),
    );
    await verifyMaintenancePage(
      maintenanceConfig(),
      receipt.maintenance,
      fetcher,
      true,
    );
    receipt.recovery = "maintenance-with-postgrest-request-guard";
    persist("recovered");
  };
  if (config.phase === "recover") {
    receipt = {
      ...receipt,
      run: config.run,
      controller: config.controller,
      observer: config.actor,
    };
    await recover();
    return receipt;
  }
  if (config.phase === "prepare") {
    await readDomain(vercel, target.branch);
    await verifyNoCompetingDeployment(vercel);
    const priorAlias = await readAlias(vercel);
    const prior = await vercel(`/v13/deployments/${priorAlias}`);
    requireCondition(
      prior.projectId === target.project &&
        prior.target === null &&
        prior.meta?.githubCommitSha === source.base &&
        prior.meta?.githubCommitRef === target.branch,
      "The prior Development alias must serve the current Development head.",
    );
    verifyQuiescence(config, query);
    await refuseEarlierStage(config, vercel, "maintenance", 0);
    receipt = {
      format: 1,
      ...source,
      candidate: config.candidate,
      controller: config.controller,
      run: config.run,
      maintenanceRun: config.run,
      observer: config.actor,
      createdAt: now(),
      expiresAt: now() + 4 * 60 * 60 * 1000,
      project: target.project,
      team: target.team,
      database: target.database,
      domain: target.domain,
      holdBranch: target.holdBranch,
      priorAlias,
      targetDigest: expectedDigest,
      externalWriters: "operator-attested-stopped-in-protected-environment",
      phase: "staging-maintenance",
    };
    await createPreview(
      config,
      vercel,
      "maintenance",
      undefined,
      (stage) => {
        receipt.maintenance = stage;
        record(receipt);
      },
      dependencies.pause,
    );
    await verifyMaintenancePage(config, receipt.maintenance, fetcher);
    await authority();
    verifyQuiescence(config, query);
    await holdDomain(vercel, priorAlias, owned());
    persist("domain-held");
  } else {
    requireCondition(
      receipt.targetDigest === expectedDigest,
      "The candidate migration inventory changed after preparation.",
    );
    receipt = {
      ...receipt,
      run: config.run,
      controller: config.controller,
      merged: source.base,
      observer: config.actor,
      preparedRun: receipt.preparedRun || receipt.maintenanceRun,
    };
    await verifyHeldAlias(vercel, [receipt.maintenance.id], owned());
    await verifyMaintenancePage(
      maintenanceConfig(),
      receipt.maintenance,
      fetcher,
      true,
    );
  }
  // Record recovery ownership before the first write-guard operation. A failed
  // process can leave the operation committed even when no response returned.
  persist("guard-armed");
  try {
    setWriteBlock(config, true, query);
    await probeWriteBlock(config, fetcher);
    settlePreexistingRequests(config, query);
    receipt.schema = verifyDevelopmentMaintenance(
      config,
      config.phase === "prepare" ? "before" : "target",
      query,
    );
    await authority();
    if (config.phase === "prepare") {
      await assignHeldAlias(
        vercel,
        receipt.maintenance.id,
        [receipt.priorAlias],
        owned(),
      );
      await verifyMaintenancePage(config, receipt.maintenance, fetcher, true);
      await authority();
      receipt.schema = verifyDevelopmentMaintenance(config, "before", query);
      await probeWriteBlock(config, fetcher);
      persist("prepared");
      return receipt;
    }
    const merged = (await authority()).base;
    receipt.merged = merged;
    if (receipt.application) {
      requireCondition(
        /^[1-9][0-9]*$/u.test(receipt.applicationRun ?? ""),
        "Recorded application run is missing.",
      );
      await waitPreview(
        { ...config, run: receipt.applicationRun },
        vercel,
        "application",
        merged,
        receipt.application,
        dependencies.pause,
      );
    } else {
      await refuseEarlierStage(
        config,
        vercel,
        "application",
        receipt.createdAt,
      );
      await createPreview(
        config,
        vercel,
        "application",
        merged,
        (stage) => {
          receipt.application = stage;
          receipt.applicationRun = config.run;
          record(receipt);
        },
        dependencies.pause,
      );
    }
    await verifyHeldAlias(vercel, [receipt.maintenance.id], owned());
    await verifyApplicationPage(config, receipt.application, merged, fetcher);
    await authority();
    receipt.schema = verifyDevelopmentMaintenance(config, "target", query);
    await probeWriteBlock(config, fetcher);
    await assignHeldAlias(
      vercel,
      receipt.application.id,
      [receipt.maintenance.id],
      owned(),
    );
    await verifyApplicationPage(
      config,
      receipt.application,
      merged,
      fetcher,
      true,
    );
    await authority();
    await verifyHeldAlias(vercel, [receipt.application.id], owned());
    receipt.schema = verifyDevelopmentMaintenance(config, "target", query);
    // Restore only the catalogued retention job. Other cron jobs and provider
    // workers require their own later activation approval.
    receipt.retentionRestored = true;
    record(receipt);
    setRetentionJob(config, true, query);
    await authority();
    await verifyHeldAlias(vercel, [receipt.application.id], owned());
    setWriteBlock(config, false, query);
    await probeWriteBlock(config, fetcher, false);
    receipt.postgrest = "fresh-zero-row-write-verified";
    receipt.hostedAcceptance = "pending-separate-existing-workflow";
    receipt.automaticDomainAssignment = "still-held";
    receipt.cron = "only-reviewed-retention-job-restored";
    persist("completed");
    return receipt;
  } catch (error) {
    receipt.failure = "forward-progress-stopped";
    record(receipt);
    try {
      await recover();
    } catch {
      receipt.recovery = "unproven-manual-reconciliation-required";
      record(receipt);
    }
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const config = cutoverConfig(process.env);
    requireCondition(
      execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim() === config.controller,
      "The controller checkout differs from the reviewed workflow candidate.",
    );
    const result = await runDevelopmentCutover(config);
    console.log(
      JSON.stringify({
        phase: result.phase,
        candidate: result.candidate,
        merged: result.merged,
        migrations: result.schema?.count,
        recovery: result.recovery,
        hostedAcceptance: result.hostedAcceptance,
        automaticDomainAssignment: result.automaticDomainAssignment,
      }),
    );
  } catch {
    console.error(
      "Development cutover stopped. Inspect the sanitized run receipt; reconcile unknown operations before retrying. Raw provider output was suppressed.",
    );
    process.exitCode = 1;
  }
}
