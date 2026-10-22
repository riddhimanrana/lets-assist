import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  membershipConfig,
  membershipPolicy,
} from "../production/membership-display-source.mjs";
import { verifyLiveBaseline } from "../production/security-only-app-source.mjs";

const receiptPath = ".artifacts/membership-display-preview.json";
const inventorySha =
  "50d25e20102baa344f625914423b07f414daf1204214f9bd6cc7b9e6fe2c0efd";
const developmentManifestSha =
  "f95a2ae9957dc404299278670beab482f0d3a3484a9e49a5de99f01305866b61";
const fail = () => {
  throw new Error("Membership-display Preview proof refused.");
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const disabled = [
  "AUTO_PUBLISH_ENABLED",
  "CSF_WORKBOOK_WORKER_ENABLED",
  "CSF_IMPORT_WORKER_ENABLED",
  "CSF_COMMUNICATIONS_WORKER_ENABLED",
  "CSF_SCHEDULED_POST_PUBLISHER_ENABLED",
  "CSF_PUBLICATION_NOTIFICATIONS_ENABLED",
  "CSF_SHEET_WRITEBACK_ENABLED",
  "ORG_SHEET_SYNC_WORKER_ENABLED",
  "ORG_CALENDAR_SYNC_WORKER_ENABLED",
  "PROJECT_CANCELLATION_WORKER_ENABLED",
];

export function membershipBaselineConfig(env) {
  const source = membershipConfig(env);
  if (
    env.VERCEL_ROOT_PROJECT_ID !== membershipPolicy.project ||
    env.VERCEL_TEAM_ID !== membershipPolicy.team ||
    !env.VERCEL_TOKEN
  )
    fail();
  return {
    ...source,
    vercelToken: env.VERCEL_TOKEN,
    projectId: membershipPolicy.project,
    teamId: membershipPolicy.team,
    repositoryId: membershipPolicy.repositoryId,
    productionAppSha: membershipPolicy.productionApp,
  };
}

export function membershipPreviewConfig(env) {
  const config = membershipBaselineConfig(env);
  if (
    env.DEVELOPMENT_PROJECT_REF !== membershipPolicy.database ||
    (!env.SUPABASE_ACCESS_TOKEN && !env.DEVELOPMENT_DATABASE_URL) ||
    !env.VERCEL_AUTOMATION_BYPASS_SECRET
  )
    fail();
  return {
    ...config,
    accessToken: env.SUPABASE_ACCESS_TOKEN,
    databaseUrl: env.DEVELOPMENT_DATABASE_URL,
    bypass: env.VERCEL_AUTOMATION_BYPASS_SECRET,
  };
}

// Existing protected Development credentials only. This is an owner-authority
// connection constrained to the pinned read-only catalog query, not a new role.
export function readMembershipDevelopmentCatalog(
  databaseUrl,
  cwd,
  execute = execFileSync,
) {
  try {
    const url = new URL(databaseUrl);
    const username = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    const sslmode = url.searchParams.get("sslmode") ?? "require";
    const direct =
      url.hostname === `db.${membershipPolicy.database}.supabase.co`;
    const pooler = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/u.test(
      url.hostname,
    );
    const expectedUser = direct
      ? /^[a-z][a-z0-9_]*$/u.test(username)
      : pooler &&
        new RegExp(
          `^[a-z][a-z0-9_]*\\.${membershipPolicy.database}$`,
          "u",
        ).test(username);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !expectedUser ||
      !password ||
      url.pathname !== "/postgres" ||
      (url.port && url.port !== "5432") ||
      url.hash ||
      [...(username + password)].some(
        (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
      ) ||
      [...url.searchParams.keys()].some((key) => key !== "sslmode") ||
      url.searchParams.getAll("sslmode").length > 1 ||
      !["require", "verify-ca", "verify-full"].includes(sslmode)
    )
      fail();
    const result = execute(
      "psql",
      ["-X", "-w", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
      {
        input: developmentCatalogQuery(cwd),
        encoding: "utf8",
        timeout: 150000,
        maxBuffer: 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH,
          LANG: "C",
          PGHOST: url.hostname,
          PGPORT: "5432",
          PGDATABASE: "postgres",
          PGUSER: username,
          PGPASSWORD: password,
          PGSSLMODE: sslmode,
          PGCONNECT_TIMEOUT: "15",
          PGOPTIONS:
            "-c default_transaction_read_only=on -c search_path=pg_catalog -c statement_timeout=120000 -c lock_timeout=5000",
        },
      },
    );
    if (result.trim() !== "t") fail();
  } catch {
    fail();
  }
}

export function membershipPreviewPayload(config) {
  const env = {
    ...Object.fromEntries(disabled.map((key) => [key, "false"])),
    CSF_WORKER_CONTROL_MODE: "environment",
    LETS_ASSIST_BUILD_SHA: config.sha,
    LETS_ASSIST_EXPLICIT_MEMBERSHIP_SHA: config.sha,
    EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF: membershipPolicy.database,
    NEXT_PUBLIC_SUPABASE_URL:
      "https://" + membershipPolicy.database + ".supabase.co",
    SUPABASE_URL: "https://" + membershipPolicy.database + ".supabase.co",
    SUPABASE_PROJECT_ID: membershipPolicy.database,
  };
  // Inherit existing Preview credentials. Never copy database/OAuth secrets
  // from GitHub into persistent Vercel deployment configuration.
  return {
    name: "lets-assist",
    project: membershipPolicy.project,
    source: "cli",
    autoAssignCustomDomains: false,
    gitSource: {
      type: "github",
      repoId: membershipPolicy.repositoryId,
      ref: "main",
      sha: config.sha,
    },
    env,
    build: { env: { ...env } },
    meta: {
      membershipDisplaySha: config.sha,
      membershipDisplayRun: config.run,
    },
  };
}

export function verifyMembershipPreview(deployment, config, id) {
  if (
    !/^dpl_[A-Za-z0-9]+$/u.test(deployment?.id ?? "") ||
    !/^[a-z0-9-]+\.vercel\.app$/u.test(deployment?.url ?? "") ||
    deployment.projectId !== membershipPolicy.project ||
    deployment.target !== null ||
    deployment.gitSource?.sha !== config.sha ||
    deployment.gitSource?.ref !== "main" ||
    String(deployment.gitSource?.repoId) !== membershipPolicy.repositoryId ||
    deployment.meta?.membershipDisplaySha !== config.sha ||
    deployment.meta?.membershipDisplayRun !== config.run ||
    (id && deployment.id !== id) ||
    !Array.isArray(deployment.alias ?? []) ||
    (deployment.alias ?? []).some(
      (alias) =>
        typeof alias !== "string" || !/^[a-z0-9-]+\.vercel\.app$/u.test(alias),
    )
  )
    fail();
  return {
    deploymentId: deployment.id,
    origin: "https://" + deployment.url,
    sha: config.sha,
    run: config.run,
  };
}

export function membershipAcceptanceOrigin(env, read = readFileSync) {
  if (!env.CSF_MEMBERSHIP_PREVIEW_RECEIPT) return "https://dev.lets-assist.com";
  const config = membershipConfig(env);
  if (
    env.CSF_HOSTED_ACCEPTANCE_MODE !== "full" ||
    env.EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF !==
      membershipPolicy.database ||
    env.CSF_MEMBERSHIP_PREVIEW_RECEIPT !== receiptPath
  )
    fail();
  return readMembershipPreviewReceipt(config, read).origin;
}

export function readMembershipPreviewReceipt(config, read = readFileSync) {
  const file = resolve(receiptPath),
    st = lstatSync(file);
  if (
    !st.isFile() ||
    st.isSymbolicLink() ||
    st.nlink !== 1 ||
    (st.mode & 0o022) !== 0 ||
    st.uid !== process.getuid() ||
    realpathSync(file) !== file
  )
    fail();
  const receipt = JSON.parse(read(file, "utf8"));
  verifyPreviewReceipt(receipt, config);
  return receipt;
}

export function verifyPreviewReceipt(receipt, config) {
  const url = new URL(receipt?.origin ?? "https://invalid.invalid");
  if (
    url.protocol !== "https:" ||
    !/^[a-z0-9-]+\.vercel\.app$/u.test(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    receipt.sha !== config.sha ||
    receipt.run !== config.run ||
    receipt.project !== membershipPolicy.project ||
    receipt.database !== membershipPolicy.database ||
    receipt.development !== membershipPolicy.development ||
    !/^dpl_[A-Za-z0-9]+$/u.test(receipt.deploymentId ?? "") ||
    !/^dpl_[A-Za-z0-9]+$/u.test(receipt.priorProduction ?? "") ||
    !/^dpl_[A-Za-z0-9]+$/u.test(receipt.priorDevelopment ?? "") ||
    receipt.readiness !== "READY"
  )
    fail();
}

export async function checkMembershipProductionBaseline(
  config,
  receipt,
  fetcher = fetch,
) {
  verifyPreviewReceipt(receipt, config);
  const deploymentId = await verifyLiveBaseline(config, fetcher);
  if (deploymentId !== receipt.priorProduction) fail();
  return deploymentId;
}

export function verifyMembershipPreviewStatus(status, config) {
  const checks = status?.checks;
  if (
    status?.environment !== "preview" ||
    status.version !== config.sha ||
    status.service !== "lets-assist" ||
    status.status !== "degraded" ||
    status.deep !== true ||
    !Array.isArray(checks) ||
    checks.length !== 4 ||
    ["environment", "database", "tables-deep"].some((name) => {
      const found = checks.filter((check) => check?.name === name);
      return (
        found.length !== 1 ||
        found[0].state !== "pass" ||
        found[0].critical !== (name !== "tables-deep")
      );
    })
  )
    fail();
  const workers = checks.filter((check) => check?.name === "workers");
  const flags = [
    "autoPublishHours",
    "csfCommunications",
    "csfImportCommit",
    "csfPublicationNotifications",
    "csfScheduledPostPublisher",
    "csfWorkbookRefresh",
    "organizationCalendarSync",
    "organizationSheetSync",
    "projectCancellationWorker",
  ];
  if (
    workers.length !== 1 ||
    workers[0].state !== "warn" ||
    workers[0].critical !== false ||
    workers[0].details?.csfControlMode !== "environment" ||
    JSON.stringify(Object.keys(workers[0].details).sort()) !==
      JSON.stringify([...flags, "csfControlMode"].sort()) ||
    flags.some((flag) => workers[0].details[flag] !== false)
  )
    fail();
}

export function developmentCatalogQuery(cwd, execute = execFileSync) {
  const read = (path) =>
    execute("git", ["show", membershipPolicy.development + ":" + path], {
      cwd,
      encoding: "utf8",
    });
  const bytes = read("scripts/production/final-schema-729.json");
  const inventory = read(
    "scripts/production/final-schema-inventory.sql",
  ).trim();
  if (
    hash(bytes) !== developmentManifestSha ||
    hash(inventory) !== inventorySha
  )
    fail();
  const manifest = JSON.parse(bytes);
  const rows = [...manifest.objects].sort((a, b) =>
    a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0,
  );
  const expected = hash(
    rows.map((row) => row.identity + "\t" + row.digest).join("\n"),
  );
  // Fixed committed SQL only. No caller-supplied SQL or raw provider errors.
  return (
    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=public,extensions; SET LOCAL statement_timeout='120s'; SET LOCAL lock_timeout='5s'; " +
    "WITH inventory AS (" +
    inventory.replace(/;$/u, "") +
    ") SELECT " +
    "(SELECT count(*)=729 AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(string_agg(version,E'\\n' ORDER BY version),'UTF8')),'hex')='" +
    manifest.ledger +
    "' FROM supabase_migrations.schema_migrations) " +
    "AND count(*)=" +
    rows.length +
    " AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(string_agg(identity||E'\\t'||digest,E'\\n' ORDER BY identity COLLATE \"C\"),'UTF8')),'hex')='" +
    expected +
    "' AS valid FROM inventory; COMMIT;"
  );
}

async function request(config, path, body, fetcher) {
  let response;
  try {
    response = await fetcher(
      "https://api.vercel.com" +
        path +
        (path.includes("?") ? "&" : "?") +
        "teamId=" +
        membershipPolicy.team,
      {
        method: body ? "POST" : "GET",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: "Bearer " + config.vercelToken,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    if (!response.ok) fail();
    return await response.json();
  } catch {
    throw new Error(
      "Preview request unproved; inspect this run's existing deployment before any new request.",
    );
  }
}

async function aliases(config, fetcher) {
  const production = await verifyLiveBaseline(config, fetcher);
  const dev = await request(
    config,
    "/v4/aliases/dev.lets-assist.com",
    undefined,
    fetcher,
  );
  if (
    dev.projectId !== membershipPolicy.project ||
    !/^dpl_[A-Za-z0-9]+$/u.test(dev.deploymentId ?? "")
  )
    fail();
  const deployment = await request(
    config,
    "/v13/deployments/" + dev.deploymentId + "?withGitRepoInfo=true",
    undefined,
    fetcher,
  );
  if (
    deployment.meta?.githubCommitSha !== membershipPolicy.development ||
    deployment.target !== null ||
    deployment.projectId !== membershipPolicy.project
  )
    fail();
  return { priorProduction: production, priorDevelopment: dev.deploymentId };
}

async function verifyBackend(config, cwd, fetcher, execute) {
  if (!config.accessToken) {
    readMembershipDevelopmentCatalog(config.databaseUrl, cwd, execute);
    return;
  }
  const response = await fetcher(
    "https://api.supabase.com/v1/projects/" +
      membershipPolicy.database +
      "/database/query/read-only",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + config.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: developmentCatalogQuery(cwd) }),
      redirect: "error",
      signal: AbortSignal.timeout(150000),
    },
  );
  if (!response.ok) fail();
  const data = await response.json();
  if (!Array.isArray(data) || data.length !== 1 || data[0].valid !== true)
    fail();
}

export async function createMembershipPreview(
  config,
  {
    fetcher = fetch,
    record,
    pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    cwd = process.cwd(),
    execute = execFileSync,
  },
) {
  await verifyBackend(config, cwd, fetcher, execute);
  const prior = await aliases(config, fetcher);
  const project = await request(
    config,
    "/v9/projects/" + membershipPolicy.project,
    undefined,
    fetcher,
  );
  if (
    project.id !== membershipPolicy.project ||
    project.accountId !== membershipPolicy.team ||
    String(project.link?.repoId) !== membershipPolicy.repositoryId ||
    project.link?.productionBranch !== "main"
  )
    fail();
  // Exactly one create; unknown outcomes never issue another POST.
  const created = await request(
    config,
    "/v13/deployments",
    membershipPreviewPayload(config),
    fetcher,
  );
  let receipt = {
    ...verifyMembershipPreview(created, config),
    ...prior,
    project: membershipPolicy.project,
    database: membershipPolicy.database,
    development: membershipPolicy.development,
    readiness: "pending",
  };
  record(receipt);
  for (let attempt = 0; attempt < 100; attempt++) {
    const deployment = await request(
      config,
      "/v13/deployments/" + created.id + "?withGitRepoInfo=true",
      undefined,
      fetcher,
    );
    verifyMembershipPreview(deployment, config, created.id);
    if (deployment.readyState === "READY") {
      receipt = { ...receipt, readiness: "READY" };
      record(receipt);
      await checkMembershipPreview(config, receipt, { fetcher, cwd, execute });
      return receipt;
    }
    if (!["QUEUED", "INITIALIZING", "BUILDING"].includes(deployment.readyState))
      fail();
    await pause(15000);
  }
  throw new Error("Recorded Preview remains pending; no rebuild is permitted.");
}

export async function checkMembershipPreview(
  config,
  receipt,
  { fetcher = fetch, cwd = process.cwd(), execute = execFileSync } = {},
) {
  verifyPreviewReceipt(receipt, config);
  const prior = await aliases(config, fetcher);
  if (
    prior.priorProduction !== receipt.priorProduction ||
    prior.priorDevelopment !== receipt.priorDevelopment
  )
    fail();
  await verifyBackend(config, cwd, fetcher, execute);
  const deployment = await request(
    config,
    "/v13/deployments/" + receipt.deploymentId + "?withGitRepoInfo=true",
    undefined,
    fetcher,
  );
  const observed = verifyMembershipPreview(
    deployment,
    config,
    receipt.deploymentId,
  );
  if (deployment.readyState !== "READY" || observed.origin !== receipt.origin)
    fail();
  const response = await fetcher(receipt.origin + "/api/status?deep=1", {
    headers: { "x-vercel-protection-bypass": config.bypass },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) fail();
  const status = await response.json();
  verifyMembershipPreviewStatus(status, config);
  return receipt;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  let phase = "configuration";
  try {
    if (process.argv[2] === "baseline") {
      const config = membershipBaselineConfig(process.env);
      phase = "baseline";
      const deploymentId = await checkMembershipProductionBaseline(
        config,
        readMembershipPreviewReceipt(config),
      );
      if (!process.env.GITHUB_OUTPUT) fail();
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        "deployment_id=" + deploymentId + "\n",
      );
    } else if (process.argv[2] === "create") {
      const config = membershipPreviewConfig(process.env);
      phase = "create-or-preflight";
      mkdirSync(".artifacts", { recursive: true, mode: 0o700 });
      const receipt = await createMembershipPreview(config, {
        record: (value) =>
          writeFileSync(receiptPath, JSON.stringify(value, null, 2) + "\n", {
            mode: 0o600,
          }),
      });
      if (!process.env.GITHUB_OUTPUT) fail();
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        "origin=" + receipt.origin + "/\n",
      );
    } else if (process.argv[2] === "check") {
      const config = membershipPreviewConfig(process.env);
      phase = "check";
      await checkMembershipPreview(
        config,
        readMembershipPreviewReceipt(config),
      );
    } else fail();
    console.log("Exact membership-display Preview verified; no alias moved.");
  } catch {
    console.error(
      `Membership-display Preview unproved; phase=${phase}; raw provider/credential output suppressed. Reconcile recorded IDs before any new create.`,
    );
    process.exitCode = 1;
  }
}
