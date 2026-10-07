import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { productionRef, ReleaseCheckError } from "./app-release-checks.mjs";
import { ledgerDigest } from "./final-schema-manifest.mjs";
import {
  executeMaintenanceQuery,
  maintenanceLedgerQuery,
  validateMaintenanceBinding,
} from "./maintenance-preflight.mjs";
import {
  bootstrapPlan,
  bootstrapMutationSql,
  bootstrapVerificationSql,
} from "./request-fence-bootstrap-plan.mjs";
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
    databaseUrl: env.PRODUCTION_BOOTSTRAP_DATABASE_URL,
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
      [config.githubToken, config.databaseUrl, config.serverKey].every(
        (value) => typeof value === "string" && value.trim(),
      ),
    "Production bootstrap requires the exact main workflow and scoped confirmations.",
  );
  validateMaintenanceBinding(productionRef, config.databaseUrl);
  const url = new URL(config.databaseUrl);
  requireCondition(
    decodeURIComponent(url.username) ===
      (url.hostname === `db.${productionRef}.supabase.co`
        ? "postgres"
        : `postgres.${productionRef}`),
    "Production bootstrap requires its reviewed owner database connection.",
  );
  return config;
}

export function productionBootstrapReader(config, fetcher = fetch) {
  return async (path) => {
    try {
      const response = await fetcher(
        `https://api.github.com/repos/${productionBootstrapTarget.repository}${path}`,
        {
          headers: {
            Authorization: `Bearer ${config.githubToken}`,
            Accept: "application/vnd.github+json",
          },
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(30_000),
        },
      );
      requireCondition(response.ok, "GitHub read refused.");
      return await response.json();
    } catch {
      throw new ReleaseCheckError(
        "Production bootstrap authority could not be read. Raw output was suppressed.",
      );
    }
  };
}

export async function verifyProductionBootstrapAuthority(
  config,
  read,
  now = Date.now(),
) {
  const [repository, main, environment, run, actor, approvals] =
    await Promise.all([
      read(""),
      read("/git/ref/heads/main"),
      read("/environments/production"),
      read(`/actions/runs/${config.run}`),
      read(`/collaborators/${config.actor}/permission`),
      read(`/actions/runs/${config.run}/approvals`),
    ]);
  const started = Date.parse(run.created_at);
  requireCondition(
    repository.id === productionBootstrapTarget.repositoryId &&
      repository.full_name === productionBootstrapTarget.repository &&
      repository.default_branch === "main" &&
      main.object?.sha === config.source &&
      run.id === Number(config.run) &&
      run.repository?.id === productionBootstrapTarget.repositoryId &&
      run.event === "workflow_dispatch" &&
      run.path === productionBootstrapTarget.workflow &&
      run.head_sha === config.source &&
      run.head_branch === "main" &&
      run.run_attempt === 1 &&
      run.status === "in_progress" &&
      run.actor?.login === config.actor &&
      run.triggering_actor?.login === config.actor &&
      Number.isFinite(started) &&
      started <= now &&
      now - started <= 4 * 60 * 60 * 1000 &&
      ["write", "maintain", "admin"].includes(actor.permission),
    "Production bootstrap source, current run or actor authority changed.",
  );
  requireCondition(
    environment.name === "production" &&
      Number.isSafeInteger(environment.id) &&
      environment.protection_rules?.some(
        (rule) =>
          rule.type === "required_reviewers" && rule.reviewers?.length > 0,
      ),
    "Production bootstrap requires configured environment reviewers.",
  );
  const reviews = Array.isArray(approvals)
    ? approvals.filter((review) =>
        review.environments?.some(
          (entry) => entry.id === environment.id && entry.name === "production",
        ),
      )
    : [];
  requireCondition(
    reviews.length === 1 &&
      reviews[0].state === "approved" &&
      typeof reviews[0].user?.login === "string" &&
      reviews[0].user.login,
    "This exact workflow run lacks an unambiguous approved Production review.",
  );
  return { reviewedBy: reviews[0].user.login, environmentId: environment.id };
}

function verifyCheckout(config, execute = execFileSync) {
  try {
    const options = {
      cwd: config.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    };
    requireCondition(
      execute("git", ["rev-parse", "HEAD"], options).trim() === config.source,
      "Checkout changed.",
    );
    execute("git", ["diff", "--exit-code", "HEAD", "--"], options);
  } catch {
    throw new ReleaseCheckError(
      "Production bootstrap requires the clean exact main checkout.",
    );
  }
}

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
  const query = dependencies.query || executeMaintenanceQuery;
  const read =
    dependencies.read ||
    productionBootstrapReader(config, dependencies.fetcher);
  const record = dependencies.record || receiptWriter(config.cwd);
  const now = dependencies.now || Date.now;
  validateMaintenanceBinding(productionRef, config.databaseUrl);
  verifyCheckout(config, dependencies.execute);
  const authority = () =>
    verifyProductionBootstrapAuthority(config, read, now());
  const approval = await authority();
  const plan = bootstrapPlan(config.cwd);
  const receipt = {
    format: 1,
    source: config.source,
    run: config.run,
    actor: config.actor,
    ...approval,
    database: productionRef,
    createdAt: now(),
    externalWriters: "operator-attested-stopped-in-protected-environment",
    before: ledgerDigest(plan.before),
    after: ledgerDigest(plan.after),
    migration: {
      version: plan.after.at(-1),
      sha256: createHash("sha256").update(plan.sql).digest("hex"),
    },
    phase: "preflight",
  };
  const persist = (phase) => {
    receipt.phase = phase;
    record({ ...receipt });
  };
  const ledger = () => {
    let result;
    try {
      result = JSON.parse(query(config.databaseUrl, maintenanceLedgerQuery));
    } catch {
      throw new ReleaseCheckError(
        "Production bootstrap ledger could not be read. Raw output was suppressed.",
      );
    }
    const same = (expected) =>
      JSON.stringify(result) === JSON.stringify(expected);
    requireCondition(
      same(plan.before) || same(plan.after),
      "Production bootstrap accepts only exact 687 or 688.",
    );
    return same(plan.after) ? "after" : "before";
  };
  const verify = (versions) =>
    requireCondition(
      query(
        config.databaseUrl,
        productionBootstrapVerificationSql(versions),
      ) === "production-bootstrap-verified",
      "Production bootstrap catalog, quiescence or open flag did not verify.",
    );
  try {
    const applied = ledger();
    verify(plan[applied]);
    // Bind the server key to a harmless read before any database mutation.
    await probeProductionBootstrapApi(config, dependencies.fetcher);
    await authority();
    if (applied === "before") {
      verifyCheckout(config, dependencies.execute);
      persist("mutation-started");
      let acknowledged = false;
      try {
        acknowledged =
          query(config.databaseUrl, bootstrapMutationSql(plan)) ===
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
      query(config.databaseUrl, productionBootstrapBarrierSql) ===
        "production-bootstrap-requests-settled",
      "Production bootstrap could not verify preexisting requests have settled.",
    );
    receipt.preexistingRequests = "settled";
    await probeProductionBootstrapApi(config, dependencies.fetcher);
    await probeProductionBootstrapApi(config, dependencies.fetcher, true);
    verify(plan.after);
    await authority();
    receipt.migrations = 688;
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
