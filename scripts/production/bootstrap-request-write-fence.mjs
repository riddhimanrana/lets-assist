import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { productionRef, ReleaseCheckError } from "./app-release-checks.mjs";
import { ledgerDigest } from "./final-schema-manifest.mjs";
import { maintenanceLedgerQuery } from "./maintenance-preflight.mjs";
import {
  executeLinkedBootstrapQuery,
  prepareLinkedBootstrapConnection,
  productionTransportConfig,
} from "./linked-bootstrap-transport.mjs";
import {
  bootstrapPlan,
  bootstrapMutationSql,
  bootstrapVerificationSql,
} from "./request-fence-bootstrap-plan.mjs";
import {
  productionRunReader,
  verifyProductionRunAuthority,
  verifyProductionCheckout,
} from "./production-run-authority.mjs";
import { settlePreexistingRequestTransactionsSql } from "./request-write-fence.mjs";

export const productionBootstrapTarget = Object.freeze({
  repository: "riddhimanrana/lets-assist",
  repositoryId: 713042374,
  database: productionRef,
  environment: "production",
  workflow: ".github/workflows/production-request-fence-bootstrap.yml",
});
const requireCondition = (condition, message) => {
  if (!condition) throw new ReleaseCheckError(message);
};
const isSha = (value) => /^[a-f0-9]{40}$/u.test(value ?? "");

export function productionBootstrapConfig(env, cwd = process.cwd()) {
  const config = {
    cwd,
    source: env.GITHUB_SHA,
    run: env.GITHUB_RUN_ID,
    actor: env.GITHUB_ACTOR,
    githubToken: env.GH_TOKEN,
    ...productionTransportConfig(env),
    serverKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
  };
  requireCondition(
    env.GITHUB_ACTIONS === "true" &&
      env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.GITHUB_REF === "refs/heads/main" &&
      env.GITHUB_RUN_ATTEMPT === "1" &&
      env.GITHUB_REPOSITORY === productionBootstrapTarget.repository &&
      env.GITHUB_REPOSITORY_ID ===
        String(productionBootstrapTarget.repositoryId) &&
      isSha(config.source) &&
      env.ACCEPTED_MAIN_SHA === config.source &&
      /^[1-9][0-9]*$/u.test(config.run ?? "") &&
      Number.isSafeInteger(Number(config.run)) &&
      /^[A-Za-z0-9-]+$/u.test(config.actor ?? "") &&
      env.SUPABASE_PROJECT_ID === productionRef &&
      env.PRODUCTION_BOOTSTRAP_CONFIRMATION ===
        `bootstrap-production:${productionRef}:${config.source}` &&
      env.EXTERNAL_WRITERS_CONFIRMATION ===
        `external-writers-stopped:${config.source}` &&
      [
        config.githubToken,
        config.accessToken,
        config.databasePassword,
        config.serverKey,
      ].every((value) => typeof value === "string" && value.trim()),
    "Production bootstrap requires the exact main workflow and scoped confirmations.",
  );
  requireCondition(
    ![...config.databasePassword].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ),
    "Production bootstrap requires its existing database password.",
  );
  return config;
}

export const productionBootstrapReader = productionRunReader;
export const verifyProductionBootstrapAuthority = (
  config,
  read,
  now = Date.now(),
) =>
  verifyProductionRunAuthority(
    config,
    read,
    now,
    productionBootstrapTarget.workflow,
  );

export function productionBootstrapVerificationSql(versions) {
  return `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=public,extensions;
SET LOCAL statement_timeout='120s';
SET LOCAL lock_timeout='5s';
${bootstrapVerificationSql(versions)}
SELECT 'production-bootstrap-verified';
COMMIT;`;
}

export const productionBootstrapBarrierSql = `BEGIN READ ONLY;
SET LOCAL search_path=public,extensions;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
${settlePreexistingRequestTransactionsSql}
SELECT 'production-bootstrap-requests-settled';
COMMIT;`;

export async function probeProductionBootstrapApi(
  config,
  fetcher = fetch,
  write = false,
) {
  const filter =
    "and=(id.eq.00000000-0000-0000-0000-000000000000,id.neq.00000000-0000-0000-0000-000000000000)";
  const headers = {
    apikey: config.serverKey,
    "Content-Type": "application/json",
  };
  if (config.serverKey.startsWith("eyJ"))
    headers.Authorization = `Bearer ${config.serverKey}`;
  if (write) headers.Prefer = "return=minimal";
  try {
    const response = await fetcher(
      `https://${productionRef}.supabase.co/rest/v1/system_banners?${write ? "" : "select=id&"}${filter}`,
      {
        method: write ? "PATCH" : "GET",
        headers,
        ...(write ? { body: JSON.stringify({ is_active: false }) } : {}),
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      },
    );
    const body = await response.text();
    requireCondition(
      write
        ? response.status === 204 && body === ""
        : response.status === 200 && body.trim() === "[]",
      "Probe refused.",
    );
  } catch {
    throw new ReleaseCheckError(
      "The fixed Production zero-row Data API probe failed. Raw output was suppressed.",
    );
  }
}

function receiptWriter(cwd) {
  const directory = resolve(
    cwd,
    ".artifacts/production-request-fence-bootstrap",
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return (receipt) => {
    const path = resolve(directory, "receipt.json");
    writeFileSync(`${path}.pending`, `${JSON.stringify(receipt, null, 2)}\n`, {
      mode: 0o600,
    });
    renameSync(`${path}.pending`, path);
  };
}

export async function runProductionBootstrap(config, dependencies = {}) {
  const query = (connection, sql) =>
    (dependencies.query || executeLinkedBootstrapQuery)(
      connection,
      sql,
      config.databasePassword,
    );
  const read =
    dependencies.read ||
    productionBootstrapReader(config, dependencies.fetcher);
  const record = dependencies.record || receiptWriter(config.cwd);
  const now = dependencies.now || Date.now;
  verifyProductionCheckout(config, dependencies.execute);
  const authority = () =>
    verifyProductionBootstrapAuthority(config, read, now());
  const approval = await authority();
  let connection;
  let plan = bootstrapPlan(config.cwd);
  const receipt = {
    format: 1,
    source: config.source,
    run: config.run,
    actor: config.actor,
    ...approval,
    database: productionRef,
    transport: "management-metadata-session-psql",
    createdAt: now(),
    externalWriters: "operator-attested-stopped-in-protected-environment",
    before: null,
    after: null,
    bootstrapPath: "unselected",
    migration: {
      version: plan.version,
      sha256: createHash("sha256").update(plan.sql).digest("hex"),
    },
    phase: "preflight",
  };
  const persist = (phase) => {
    receipt.phase = phase;
    record({ ...receipt });
  };
  const readLedger = () => {
    let result;
    try {
      result = JSON.parse(query(connection, maintenanceLedgerQuery));
    } catch {
      throw new ReleaseCheckError(
        "Production bootstrap ledger could not be read. Raw output was suppressed.",
      );
    }
    return result;
  };
  const ledger = () => {
    const result = readLedger();
    const same = (expected) =>
      JSON.stringify(result) === JSON.stringify(expected);
    requireCondition(
      same(plan.before) || same(plan.after),
      "Production bootstrap accepts only its exact reviewed before or after ledger.",
    );
    return same(plan.after) ? "after" : "before";
  };
  const verify = (versions) =>
    requireCondition(
      query(connection, productionBootstrapVerificationSql(versions)) ===
        "production-bootstrap-verified",
      "Production bootstrap catalog, quiescence or open flag did not verify.",
    );
  try {
    connection = await (dependencies.link || prepareLinkedBootstrapConnection)(
      config,
    );
    const observed = readLedger();
    plan = bootstrapPlan(config.cwd, readFileSync, observed);
    receipt.before = ledgerDigest(plan.before);
    receipt.after = ledgerDigest(plan.after);
    receipt.bootstrapPath =
      plan.before.length === 687 ? "687-to-688" : "points-first-688-to-689";
    const applied =
      JSON.stringify(observed) === JSON.stringify(plan.after)
        ? "after"
        : "before";
    verify(plan[applied]);
    // Bind the server key to a harmless read before any database mutation.
    await probeProductionBootstrapApi(config, dependencies.fetcher);
    await authority();
    if (applied === "before") {
      verifyProductionCheckout(config, dependencies.execute);
      persist("mutation-started");
      let acknowledged = false;
      try {
        acknowledged =
          query(connection, bootstrapMutationSql(plan)) ===
          "request-fence-bootstrap-applied";
      } catch {
        // A lost response never permits replaying the mutation in this run.
      }
      requireCondition(
        ledger() === "after",
        "Bootstrap outcome is unproven. Reconcile the exact ledger before a new approved run.",
      );
      verify(plan.after);
      receipt.mutation = acknowledged
        ? "acknowledged"
        : "verified-after-unknown-response";
    } else receipt.mutation = "already-applied";
    // Catalog readback cannot prove a post-commit request barrier completed.
    requireCondition(
      query(connection, productionBootstrapBarrierSql) ===
        "production-bootstrap-requests-settled",
      "Production bootstrap could not verify preexisting requests have settled.",
    );
    receipt.preexistingRequests = "settled";
    await probeProductionBootstrapApi(config, dependencies.fetcher);
    await probeProductionBootstrapApi(config, dependencies.fetcher, true);
    verify(plan.after);
    await authority();
    receipt.migrations = plan.after.length;
    receipt.head = plan.after.at(-1);
    receipt.requestFence = "installed-disabled";
    receipt.api = "fresh-read-and-zero-row-write";
    persist("verified");
    return receipt;
  } catch {
    persist("unproven");
    throw new ReleaseCheckError(
      "Production bootstrap did not complete its proof. Inspect its sanitized receipt and reconcile before retrying; no rollback or other migration was attempted.",
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const result = await runProductionBootstrap(
      productionBootstrapConfig(process.env),
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(
      "Production request-fence bootstrap refused or remains unproven. No raw provider output was logged.\n",
    );
    process.exitCode = 1;
  }
}
