import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { productionRef, ReleaseCheckError } from "./app-release-checks.mjs";
import {
  executeMaintenanceQuery,
  maintenanceLedgerQuery,
  maintenanceVerificationQuery,
  validateMaintenanceBinding,
} from "./maintenance-preflight.mjs";
import {
  productionRunReader,
  productionRunTarget,
  verifyProductionCheckout,
  verifyProductionRunAuthority,
} from "./production-run-authority.mjs";
import {
  pointsFirstMutationSql,
  pointsFirstPlan,
  preparePointsFirstMigration,
} from "./points-first-rollout-plan.mjs";

const workflow = ".github/workflows/deploy-schema.yml";
const requireCondition = (condition, message) => {
  if (!condition) throw new ReleaseCheckError(message);
};

export function productionPointsFirstConfig(env, cwd = process.cwd()) {
  const config = {
    cwd,
    source: env.GITHUB_SHA,
    run: env.GITHUB_RUN_ID,
    actor: env.GITHUB_ACTOR,
    githubToken: env.GH_TOKEN,
    databaseUrl: env.PRODUCTION_BOOTSTRAP_DATABASE_URL,
    recoveryCaptureSha256: env.RECOVERY_CAPTURE_SHA256,
  };
  requireCondition(
    env.GITHUB_ACTIONS === "true" &&
      env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.GITHUB_REF === "refs/heads/main" &&
      env.GITHUB_RUN_ATTEMPT === "1" &&
      env.GITHUB_REPOSITORY === productionRunTarget.repository &&
      env.GITHUB_REPOSITORY_ID === String(productionRunTarget.repositoryId) &&
      /^[a-f0-9]{40}$/u.test(config.source ?? "") &&
      /^[1-9][0-9]*$/u.test(config.run ?? "") &&
      Number.isSafeInteger(Number(config.run)) &&
      /^[A-Za-z0-9-]+$/u.test(config.actor ?? "") &&
      env.SUPABASE_PROJECT_ID === productionRef &&
      env.PRODUCTION_DEPLOY_CONFIRMATION ===
        `deploy-production:${productionRef}` &&
      env.APPLICATION_WRITES_BLOCKED_CONFIRMATION ===
        `application-writes-blocked:${config.source}` &&
      env.EXTERNAL_WRITERS_CONFIRMATION ===
        `external-writers-stopped:${config.source}` &&
      /^[a-f0-9]{64}$/u.test(config.recoveryCaptureSha256 ?? "") &&
      env.RECOVERY_CAPTURE_CONFIRMATION ===
        `recovery-capture-verified:${config.source}:${config.recoveryCaptureSha256}` &&
      [config.githubToken, config.databaseUrl].every(
        (value) => typeof value === "string" && value.trim(),
      ),
    "The bounded rollout requires the exact protected main run and recovery confirmations.",
  );
  validateMaintenanceBinding(productionRef, config.databaseUrl);
  const url = new URL(config.databaseUrl);
  requireCondition(
    decodeURIComponent(url.username) ===
      (url.hostname === `db.${productionRef}.supabase.co`
        ? "postgres"
        : `postgres.${productionRef}`),
    "The bounded rollout requires the existing reviewed owner connection.",
  );
  return config;
}

export async function verifyPointsFirstAuthority(
  config,
  read,
  now = Date.now(),
) {
  const approval = await verifyProductionRunAuthority(
    config,
    read,
    now,
    workflow,
  );
  const jobs = await read(
    `/actions/runs/${config.run}/jobs?filter=latest&per_page=100`,
  );
  requireCondition(
    Number.isSafeInteger(jobs.total_count) &&
      jobs.total_count > 0 &&
      jobs.total_count <= 100 &&
      jobs.jobs?.length === jobs.total_count,
    "The exact run's prior-recovery gate could not be enumerated.",
  );
  const gates = jobs.jobs.filter(
    (job) => job.name === "Require prior Production reconciliations",
  );
  requireCondition(
    gates.length === 1 &&
      gates[0].run_id === Number(config.run) &&
      gates[0].head_sha === config.source &&
      gates[0].status === "completed" &&
      gates[0].conclusion === "success",
    "The exact run lacks its successful trusted prior-recovery gate.",
  );
  return approval;
}

function receiptWriter(cwd) {
  const directory = resolve(cwd, ".artifacts/production-points-first-rollout");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return (receipt) => {
    const path = resolve(directory, "receipt.json");
    writeFileSync(`${path}.pending`, `${JSON.stringify(receipt, null, 2)}\n`, {
      mode: 0o600,
    });
    renameSync(`${path}.pending`, path);
  };
}

export function boundedPointsFirstQuery(
  databaseUrl,
  sql,
  deadline,
  now = Date.now,
  execute = execFileSync,
) {
  const remaining = deadline - now();
  requireCondition(
    Number.isFinite(remaining) && remaining > 0,
    "The bounded rollout database deadline expired.",
  );
  return executeMaintenanceQuery(databaseUrl, sql, (command, args, options) =>
    execute(command, args, {
      ...options,
      timeout: Math.min(options.timeout, remaining),
    }),
  );
}

export async function runProductionPointsFirst(
  config,
  mode,
  dependencies = {},
) {
  requireCondition(
    ["plan", "apply"].includes(mode),
    "The bounded rollout requires one fixed mode.",
  );
  const read =
    dependencies.read || productionRunReader(config, dependencies.fetcher);
  const now = dependencies.now || Date.now;
  const startedAt = now();
  const deadline = startedAt + (mode === "plan" ? 2 : 12) * 60 * 1000;
  const query =
    dependencies.query ||
    ((url, sql) => boundedPointsFirstQuery(url, sql, deadline, now));
  const record = dependencies.record || receiptWriter(config.cwd);
  validateMaintenanceBinding(productionRef, config.databaseUrl);
  verifyProductionCheckout(config, dependencies.execute);
  const authority = () => verifyPointsFirstAuthority(config, read, now());
  const approval = await authority();
  const receipt = {
    format: 1,
    mode,
    source: config.source,
    run: config.run,
    actor: config.actor,
    ...approval,
    database: productionRef,
    recoveryCaptureSha256: config.recoveryCaptureSha256,
    createdAt: startedAt,
    phase: "preflight",
    before: null,
    after: null,
    migrations: [],
  };
  const persist = (phase) => {
    receipt.phase = phase;
    record(structuredClone(receipt));
  };
  const readState = () => {
    let versions;
    try {
      versions = JSON.parse(query(config.databaseUrl, maintenanceLedgerQuery));
    } catch {
      throw new ReleaseCheckError(
        "The bounded rollout ledger could not be read. Raw output was suppressed.",
      );
    }
    return pointsFirstPlan(config.cwd, versions);
  };
  const verify = (state) =>
    requireCondition(
      query(
        config.databaseUrl,
        maintenanceVerificationQuery(state.versions),
      ) === "maintenance-preflight-verified",
      "The exact rollout catalog, write block, quiescence or data checks did not verify.",
    );
  try {
    let plan = readState();
    receipt.before = plan.state.ledger;
    receipt.after = plan.state.ledger;
    verify(plan.state);
    if (mode === "plan") {
      receipt.remaining = plan.remaining.map(({ migration, sha256 }) => ({
        migration,
        sha256,
      }));
      receipt.target = plan.target.ledger;
      await authority();
      persist("planned");
      return receipt;
    }
    while (plan.remaining.length) {
      requireCondition(
        now() - startedAt < 8 * 60 * 1000,
        "The rollout write budget expired. Reconcile before a fresh protected run.",
      );
      await authority();
      verifyProductionCheckout(config, dependencies.execute);
      const next = preparePointsFirstMigration(config.cwd, plan.state.versions);
      verify(next.before);
      requireCondition(
        now() - startedAt < 8 * 60 * 1000,
        "The write budget expired during authority or preflight verification.",
      );
      const entry = {
        version: next.migration.version,
        sha256: next.migration.sha256,
        before: next.before.ledger,
        after: next.after.ledger,
        outcome: "started",
      };
      receipt.migrations.push(entry);
      persist("mutation-started");
      let acknowledged = false;
      try {
        acknowledged =
          query(config.databaseUrl, pointsFirstMutationSql(next)) ===
          "points-first-migration-applied";
      } catch {
        // Reconcile once. Never resubmit a file after a lost or failed response.
      }
      const observed = readState();
      requireCondition(
        observed.state.ledger === next.after.ledger,
        "The migration outcome is unproven. No further file may run.",
      );
      verify(observed.state);
      receipt.after = observed.state.ledger;
      entry.outcome = acknowledged
        ? "acknowledged-and-verified"
        : "verified-after-unknown-response";
      persist("migration-verified");
      requireCondition(
        acknowledged,
        "A migration committed without its exact response. Reconcile through trusted recovery before a fresh run.",
      );
      plan = observed;
    }
    verify(plan.state);
    await authority();
    receipt.targetMigrations = plan.state.count;
    receipt.catalog = "verified";
    persist("verified");
    return receipt;
  } catch {
    persist("unproven");
    throw new ReleaseCheckError(
      "The bounded Production rollout stopped. Inspect its sanitized receipt and complete trusted recovery before a fresh run; no file was retried.",
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    if (process.argv.length !== 3)
      throw new ReleaseCheckError("One fixed rollout mode is required.");
    const result = await runProductionPointsFirst(
      productionPointsFirstConfig(process.env),
      process.argv[2],
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(
      "The bounded Production rollout refused or remains unproven. No raw provider output was logged.\n",
    );
    process.exitCode = 1;
  }
}
