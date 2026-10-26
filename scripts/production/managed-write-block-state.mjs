import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { productionRef, ReleaseCheckError } from "./app-release-checks.mjs";
import {
  productionPointsFirstConfig,
  verifyPointsFirstAuthority,
} from "./points-first-rollout.mjs";
import {
  productionRunReader,
  verifyProductionCheckout,
} from "./production-run-authority.mjs";
import {
  executeReadOnlyQuery,
  maintenanceLedgerQuery,
  resolveMaintenanceConnection,
} from "./maintenance-preflight.mjs";
import { pointsFirstPlan } from "./points-first-rollout-plan.mjs";
import {
  applicationRequestWriteFenceQuery,
  applicationRequestWritesOpenQuery,
} from "./request-write-fence.mjs";
import { probeProductionBootstrapApi } from "./bootstrap-request-write-fence.mjs";

const requireCondition = (condition) => {
  if (!condition)
    throw new ReleaseCheckError(
      "The managed-backup temporary write-block state is unproven. Raw output was suppressed.",
    );
};
const stateQuery = `BEGIN READ ONLY;
SELECT json_build_object('fence', (${applicationRequestWriteFenceQuery}),
  'open', (${applicationRequestWritesOpenQuery}),
  'blocked', EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticator'
    AND 'pgrst.app_settings.maintenance_write_block=on'=ANY(coalesce(rolconfig,ARRAY[]::text[]))));
COMMIT;`;

// Fixed read-only checks only. The protected workflow owns the existing shell
// enable/reset calls and supplies their actual step outcomes, never inputs.
export async function managedWriteBlockState(mode, env, dependencies = {}) {
  requireCondition(["prepare", "can-restore", "restored"].includes(mode));
  let config = productionPointsFirstConfig(env, dependencies.cwd);
  requireCondition(config.recoveryMode === "managed-backup");
  const read =
    dependencies.read || productionRunReader(config, dependencies.fetcher);
  const authority =
    dependencies.authority ||
    (() =>
      verifyPointsFirstAuthority(
        config,
        read,
        (dependencies.now || Date.now)(),
      ));
  verifyProductionCheckout(config, dependencies.execute);
  await authority();
  config = await (dependencies.connect || resolveMaintenanceConnection)(config);
  const query = dependencies.query || executeReadOnlyQuery;
  const directory = resolve(
    config.cwd,
    ".artifacts/production-early-write-block",
  );
  const path = resolve(directory, "receipt.json");
  const record =
    dependencies.record ||
    ((receipt) => {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      writeFileSync(`${path}.pending`, `${JSON.stringify(receipt)}\n`, {
        mode: 0o600,
      });
      renameSync(`${path}.pending`, path);
    });
  const versions = JSON.parse(
    query(config.databaseUrl, maintenanceLedgerQuery),
  );
  const plan = pointsFirstPlan(config.cwd, versions);
  const state = JSON.parse(query(config.databaseUrl, stateQuery));
  requireCondition(state.fence === true);
  if (mode === "prepare") {
    const started = Number(env.PRODUCTION_JOB_STARTED_AT);
    const elapsed =
      Math.floor((dependencies.now || Date.now)() / 1000) - started;
    requireCondition(
      Number.isSafeInteger(started) &&
        started > 0 &&
        elapsed >= 0 &&
        elapsed <= 2100,
    );
    requireCondition(state.open === true && state.blocked === false);
    const receipt = {
      format: 1,
      source: config.source,
      run: config.run,
      database: productionRef,
      ledger: plan.state.ledger,
      phase: "owned-open-state",
    };
    record(receipt);
    return receipt;
  }
  const receipt =
    dependencies.receipt || JSON.parse(readFileSync(path, "utf8"));
  requireCondition(
    receipt.format === 1 &&
      receipt.source === config.source &&
      receipt.run === config.run &&
      receipt.database === productionRef &&
      receipt.ledger === plan.state.ledger &&
      receipt.phase === "owned-open-state",
  );
  requireCondition(
    env.EARLY_ENABLE_OUTCOME === "success" &&
      env.LATE_ENABLE_OUTCOME === "skipped" &&
      env.MAINTENANCE_ALIAS_OUTCOME === "skipped" &&
      env.APPLICATION_ALIAS_OUTCOME === "skipped" &&
      env.SCHEMA_PUSH_OUTCOME === "skipped",
  );
  if (mode === "can-restore") {
    requireCondition(state.blocked === true && state.open === false);
    return { ...receipt, phase: "safe-to-reset" };
  }
  requireCondition(state.open === true && state.blocked === false);
  const serverKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  requireCondition(typeof serverKey === "string" && serverKey.trim());
  await (dependencies.probe || probeProductionBootstrapApi)(
    { serverKey },
    dependencies.fetcher,
  );
  await (dependencies.probe || probeProductionBootstrapApi)(
    { serverKey },
    dependencies.fetcher,
    true,
  );
  await authority();
  const restored = { ...receipt, phase: "restored-open-state" };
  record(restored);
  return restored;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    requireCondition(process.argv.length === 3);
    const receipt = await managedWriteBlockState(process.argv[2], process.env);
    console.log(JSON.stringify(receipt));
  } catch {
    console.error(
      "The managed-backup temporary write-block state is unproven. Raw output was suppressed.",
    );
    process.exitCode = 1;
  }
}
