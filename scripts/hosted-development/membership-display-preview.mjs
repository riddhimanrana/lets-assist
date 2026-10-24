import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
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
const developmentCaFile =
  "scripts/hosted-development/membership-display-development-ca.pem";
const fail = () => {
  throw new Error("Membership-display Preview proof refused.");
};
const diagnosticCodes = new Set([
  "database-url",
  "database-target",
  "database-auth-input",
  "database-name",
  "database-port",
  "database-options",
  "database-tls-mode",
  "database-ca",
  "database-query-source",
  "database-client",
  "database-timeout",
  "database-tls",
  "database-auth",
  "database-dns",
  "database-network",
  "database-network-unreachable",
  "database-no-route",
  "database-connect",
  "database-query",
  "database-output",
  "development-catalog-mismatch",
]);
class PreviewReadFailure extends Error {
  constructor(code) {
    super("Membership-display Preview proof refused.");
    this.code = diagnosticCodes.has(code) ? code : "unclassified";
  }
}
const refuseRead = (code) => {
  throw new PreviewReadFailure(code);
};
export function membershipPreviewDiagnosticCode(error) {
  return error instanceof PreviewReadFailure && diagnosticCodes.has(error.code)
    ? error.code
    : "unclassified";
}
function clientFailureCode(error) {
  if (error?.code === "ENOENT") return "database-client";
  const stderr =
    typeof error?.stderr === "string" || Buffer.isBuffer(error?.stderr)
      ? error.stderr.toString().slice(0, 8192)
      : "";
  if (
    error?.code === "ETIMEDOUT" ||
    /timeout expired|connection timed out/iu.test(stderr)
  )
    return "database-timeout";
  if (/certificate|SSL error|TLS|does not match host name/iu.test(stderr))
    return "database-tls";
  if (
    /password authentication failed|SASL authentication|authentication failed/iu.test(
      stderr,
    )
  )
    return "database-auth";
  if (
    /could not translate host name|Name or service not known|Temporary failure in name resolution/iu.test(
      stderr,
    )
  )
    return "database-dns";
  const networkUnreachable = /Network is unreachable/iu.test(stderr);
  const noRoute = /No route to host/iu.test(stderr);
  if (networkUnreachable && noRoute) return "database-network";
  if (networkUnreachable) return "database-network-unreachable";
  if (noRoute) return "database-no-route";
  return error?.status === 3 ? "database-query" : "database-connect";
}
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
export function verifyMembershipDevelopmentCa(
  cwd,
  {
    stat = lstatSync,
    realpath = realpathSync,
    read = readFileSync,
    execute = execFileSync,
  } = {},
) {
  try {
    const file = resolve(cwd, developmentCaFile),
      st = stat(file);
    if (
      !st.isFile() ||
      st.isSymbolicLink() ||
      st.nlink !== 1 ||
      st.uid !== process.getuid() ||
      (st.mode & 0o022) !== 0 ||
      realpath(file) !== file
    )
      fail();
    const bytes = read(file);
    const committed = execute("git", ["show", "HEAD:" + developmentCaFile], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10000,
      maxBuffer: 16384,
    });
    const pem = bytes.toString("utf8");
    if (
      bytes.length > 16384 ||
      hash(bytes) !== hash(committed) ||
      !/^-----BEGIN CERTIFICATE-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END CERTIFICATE-----\r?\n?$/u.test(
        pem,
      ) ||
      new X509Certificate(bytes).ca !== true
    )
      fail();
    return file;
  } catch {
    fail();
  }
}

export function readMembershipDevelopmentCatalog(
  databaseUrl,
  cwd,
  execute = execFileSync,
  verifyCa = verifyMembershipDevelopmentCa,
) {
  let stage = "database-url";
  try {
    const url = new URL(databaseUrl);
    const username = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    const requestedSslmode = url.searchParams.get("sslmode");
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
    if (!["postgres:", "postgresql:"].includes(url.protocol))
      refuseRead("database-url");
    if (!expectedUser) refuseRead("database-target");
    if (
      !password ||
      [...(username + password)].some(
        (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
      )
    )
      refuseRead("database-auth-input");
    if (url.pathname !== "/postgres") refuseRead("database-name");
    if (url.port && url.port !== "5432") refuseRead("database-port");
    if (
      url.hash ||
      [...url.searchParams.keys()].some((key) => key !== "sslmode") ||
      url.searchParams.getAll("sslmode").length > 1
    )
      refuseRead("database-options");
    if (
      requestedSslmode !== null &&
      !["require", "verify-ca", "verify-full"].includes(requestedSslmode)
    )
      refuseRead("database-tls-mode");
    stage = "database-ca";
    const caPath = verifyCa(cwd);
    stage = "database-query-source";
    const query = developmentCatalogQuery(cwd);
    stage = "database-connect";
    const result = execute(
      "psql",
      ["-X", "-w", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
      {
        input: query,
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
          // Never inherit weaker TLS modes from an existing connection URI.
          // The public provider CA must land in the reviewed source before
          // publication. An absent/untrusted CA fails libpq verification.
          PGSSLMODE: "verify-full",
          PGSSLROOTCERT: caPath,
          PGCONNECT_TIMEOUT: "15",
          PGOPTIONS:
            "-c default_transaction_read_only=on -c search_path=pg_catalog -c statement_timeout=120000 -c lock_timeout=5000",
        },
      },
    );
    if (result.trim() === "f") refuseRead("development-catalog-mismatch");
    if (result.trim() !== "t") refuseRead("database-output");
  } catch (error) {
    if (error instanceof PreviewReadFailure) throw error;
    refuseRead(stage === "database-connect" ? clientFailureCode(error) : stage);
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

async function verifyBackend(config, cwd, fetcher, execute, verifyCa) {
  if (!config.accessToken) {
    readMembershipDevelopmentCatalog(
      config.databaseUrl,
      cwd,
      execute,
      verifyCa,
    );
    return;
  }
  let query, response, data;
  try {
    query = developmentCatalogQuery(cwd);
  } catch {
    refuseRead("database-query-source");
  }
  try {
    response = await fetcher(
      "https://api.supabase.com/v1/projects/" +
        membershipPolicy.database +
        "/database/query/read-only",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + config.accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
        redirect: "error",
        signal: AbortSignal.timeout(150000),
      },
    );
  } catch (error) {
    refuseRead(
      error?.name === "TimeoutError" || error?.name === "AbortError"
        ? "database-timeout"
        : "database-connect",
    );
  }
  if (!response.ok)
    refuseRead(
      [401, 403].includes(response.status) ? "database-auth" : "database-query",
    );
  try {
    data = await response.json();
  } catch {
    refuseRead("database-output");
  }
  if (Array.isArray(data) && data.length === 1 && data[0]?.valid === false)
    refuseRead("development-catalog-mismatch");
  if (!Array.isArray(data) || data.length !== 1 || data[0]?.valid !== true)
    refuseRead("database-output");
}

export async function createMembershipPreview(
  config,
  {
    fetcher = fetch,
    record,
    pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    cwd = process.cwd(),
    execute = execFileSync,
    verifyCa = verifyMembershipDevelopmentCa,
    onPhase = () => {},
  },
) {
  onPhase("development-catalog");
  await verifyBackend(config, cwd, fetcher, execute, verifyCa);
  onPhase("vercel-aliases");
  const prior = await aliases(config, fetcher);
  onPhase("vercel-project");
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
  onPhase("preview-create");
  const created = await request(
    config,
    "/v13/deployments",
    membershipPreviewPayload(config),
    fetcher,
  );
  onPhase("preview-receipt");
  let receipt = {
    ...verifyMembershipPreview(created, config),
    ...prior,
    project: membershipPolicy.project,
    database: membershipPolicy.database,
    development: membershipPolicy.development,
    readiness: "pending",
  };
  record(receipt);
  onPhase("preview-readiness");
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
      onPhase("preview-postcheck");
      await checkMembershipPreview(config, receipt, {
        fetcher,
        cwd,
        execute,
        verifyCa,
      });
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
  {
    fetcher = fetch,
    cwd = process.cwd(),
    execute = execFileSync,
    verifyCa = verifyMembershipDevelopmentCa,
  } = {},
) {
  verifyPreviewReceipt(receipt, config);
  const prior = await aliases(config, fetcher);
  if (
    prior.priorProduction !== receipt.priorProduction ||
    prior.priorDevelopment !== receipt.priorDevelopment
  )
    fail();
  await verifyBackend(config, cwd, fetcher, execute, verifyCa);
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
        onPhase: (value) => {
          if (
            ![
              "development-catalog",
              "vercel-aliases",
              "vercel-project",
              "preview-create",
              "preview-receipt",
              "preview-readiness",
              "preview-postcheck",
            ].includes(value)
          )
            fail();
          phase = value;
        },
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
  } catch (error) {
    console.error(
      `Membership-display Preview unproved; phase=${phase}; reason=${membershipPreviewDiagnosticCode(error)}; raw provider/credential output suppressed. Reconcile recorded IDs before any new create.`,
    );
    process.exitCode = 1;
  }
}
