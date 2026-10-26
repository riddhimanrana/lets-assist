import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  productionBootstrapReader,
  productionBootstrapTarget,
  verifyProductionBootstrapAuthority,
} from "./bootstrap-request-write-fence.mjs";
import { verifyProductionCheckout } from "./production-run-authority.mjs";
import { maintenanceTarget } from "./maintenance-preflight.mjs";
import { ledgerDigest } from "./final-schema-manifest.mjs";
import {
  pointsFirstRolloutStates,
  pointsFirstRolloutMigrations,
  pointsFirstRolloutTarget,
} from "./points-first-rollout-catalog.mjs";
import { ReleaseCheckError } from "./app-release-checks.mjs";

// One fixed SELECT, with no caller-provided SQL or psql transaction envelope.
// CLI --linked uses the Management API; this is not a restricted database login.
export const diagnosticLedgerSql =
  "SELECT coalesce(json_agg(version::text ORDER BY version), '[]'::json) AS versions FROM supabase_migrations.schema_migrations;";
const requireCondition = (condition, message) => {
  if (!condition) throw new ReleaseCheckError(message);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function requestFenceDiagnosticConfig(env, cwd = process.cwd()) {
  const config = {
    cwd,
    source: env.GITHUB_SHA,
    run: env.GITHUB_RUN_ID,
    actor: env.GITHUB_ACTOR,
    githubToken: env.GH_TOKEN,
  };
  requireCondition(
    env.GITHUB_ACTIONS === "true" &&
      env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.GITHUB_REF === "refs/heads/main" &&
      env.GITHUB_RUN_ATTEMPT === "1" &&
      env.GITHUB_REPOSITORY === productionBootstrapTarget.repository &&
      env.GITHUB_REPOSITORY_ID ===
        String(productionBootstrapTarget.repositoryId) &&
      /^[a-f0-9]{40}$/u.test(config.source ?? "") &&
      env.ACCEPTED_MAIN_SHA === config.source &&
      /^[1-9][0-9]*$/u.test(config.run ?? "") &&
      Number.isSafeInteger(Number(config.run)) &&
      /^[A-Za-z0-9-]+$/u.test(config.actor ?? "") &&
      env.SUPABASE_PROJECT_ID === productionBootstrapTarget.database &&
      env.PRODUCTION_BOOTSTRAP_CONFIRMATION ===
        `diagnose-production:${productionBootstrapTarget.database}:${config.source}` &&
      [
        config.githubToken,
        env.SUPABASE_ACCESS_TOKEN,
        env.SUPABASE_DB_PASSWORD,
      ].every((value) => typeof value === "string" && value.trim()),
    "CLI diagnosis requires the exact protected main workflow and diagnostic confirmation.",
  );
  return config;
}

export function diagnosticLedger(output) {
  let result;
  try {
    result = JSON.parse(output);
  } catch {
    throw new ReleaseCheckError("CLI ledger JSON was empty or malformed.");
  }
  requireCondition(
    Array.isArray(result) &&
      result.length === 1 &&
      same(Object.keys(result[0] || {}), ["versions"]) &&
      same(result[0]?.versions, pointsFirstRolloutStates[0].versions),
    "CLI ledger differs from the exact points-first 688 baseline.",
  );
  return result[0].versions;
}

export function verifyDiagnosticDryRun(output) {
  let result;
  try {
    result = JSON.parse(output);
  } catch {
    throw new ReleaseCheckError("CLI dry-run JSON was empty or malformed.");
  }
  requireCondition(
    result &&
      same(Object.keys(result).sort(), [
        "dryRun",
        "message",
        "migrations",
        "roles",
        "seeds",
        "upToDate",
      ]) &&
      result.dryRun === true &&
      result.upToDate === false &&
      result.message === "Finished supabase db push." &&
      same(result.roles, []) &&
      same(result.seeds, []) &&
      same(
        result.migrations,
        pointsFirstRolloutMigrations.map((step) => step.migration),
      ),
    "CLI dry-run did not report the exact reviewed 52-file pending set.",
  );
  return result.migrations;
}

export async function runRequestFenceDiagnostic(
  config,
  env,
  dependencies = {},
) {
  const read = dependencies.read || productionBootstrapReader(config);
  const now = dependencies.now || Date.now;
  const execute = dependencies.execute || spawnSync;
  const checkout = () =>
    verifyProductionCheckout(config, dependencies.checkoutExecute);
  const directory = resolve(
    config.cwd,
    ".artifacts/production-request-fence-bootstrap",
  );
  const record =
    dependencies.record ||
    ((receipt) => {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      writeFileSync(
        resolve(directory, "receipt.json"),
        `${JSON.stringify(receipt, null, 2)}\n`,
        { mode: 0o600 },
      );
    });
  const receipt = {
    format: 1,
    mode: "diagnose",
    source: config.source,
    run: config.run,
    database: productionBootstrapTarget.database,
    mutation: "not-attempted",
    phase: "authority",
    createdAt: now(),
  };
  const cli = (args) => {
    const result = execute("supabase", args, {
      cwd: config.cwd,
      encoding: "utf8",
      timeout: 150_000,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: env.PATH,
        HOME: env.HOME,
        LANG: "C",
        NO_COLOR: "1",
        SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN,
        SUPABASE_DB_PASSWORD: env.SUPABASE_DB_PASSWORD,
        SUPABASE_EXPERIMENTAL_STACK: "0",
        SUPABASE_TRACE_FILE: "",
        SUPABASE_OTLP_ENDPOINT: "",
        SUPABASE_OTLP_HEADERS: "",
      },
    });
    // Counts/status identify transport failure without leaking connection strings.
    receipt.command = {
      invocation: args.slice(0, 2).join(" "),
      status: result.status ?? null,
      stdoutBytes: Buffer.byteLength(result.stdout || ""),
      stderrBytes: Buffer.byteLength(result.stderr || ""),
    };
    requireCondition(
      !result.error && result.status === 0,
      "CLI command failed.",
    );
    return result;
  };
  const authority = () =>
    verifyProductionBootstrapAuthority(config, read, now());
  const project = productionBootstrapTarget.database;
  try {
    requireCondition(
      [env.SUPABASE_ACCESS_TOKEN, env.SUPABASE_DB_PASSWORD].every(
        (value) => typeof value === "string" && value.trim(),
      ),
      "CLI diagnosis requires both existing credentials before any CLI command.",
    );
    checkout();
    Object.assign(receipt, await authority());
    receipt.phase = "repository-bytes";
    const target = maintenanceTarget(config.cwd, dependencies.readMigration);
    requireCondition(
      target.length === 740 &&
        ledgerDigest(target) === pointsFirstRolloutTarget.ledger,
      "Diagnostic requires the exact reviewed 740-file target.",
    );
    receipt.phase = "cli-help";
    requireCondition(
      cli(["--version"]).stdout.trim() === "2.120.0",
      "CLI version differs from the reviewed pin.",
    );
    const help = cli(["--help"]).stdout;
    cli(["db", "--help"]);
    const linkHelp = cli(["link", "--help"]).stdout;
    const queryHelp = cli(["db", "query", "--help"]).stdout;
    const pushHelp = cli(["db", "push", "--help"]).stdout;
    requireCondition(
      help.includes("--output-format") &&
        help.includes("--agent") &&
        linkHelp.includes("--project-ref") &&
        queryHelp.includes("--linked") &&
        queryHelp.includes("--project-ref") &&
        queryHelp.includes("--output") &&
        pushHelp.includes("--linked") &&
        pushHelp.includes("--project-ref") &&
        pushHelp.includes("--dry-run") &&
        pushHelp.includes("--include-all") &&
        pushHelp.includes("--skip-vault"),
      "Pinned CLI help lacks a required diagnostic flag.",
    );
    receipt.phase = "link";
    const linked = JSON.parse(
      cli(["link", "--project-ref", project, "--output-format", "json"]).stdout,
    );
    requireCondition(
      same(Object.keys(linked || {}).sort(), ["message", "project_ref"]) &&
        linked.project_ref === project &&
        linked.message === "",
      "CLI linked a different project.",
    );
    const readLedger = () =>
      diagnosticLedger(
        cli([
          "db",
          "query",
          "--linked",
          "--project-ref",
          project,
          "--agent",
          "no",
          "--output",
          "json",
          diagnosticLedgerSql,
        ]).stdout,
      );
    receipt.phase = "ledger-before";
    receipt.before = ledgerDigest(readLedger());
    await authority();
    checkout();
    receipt.phase = "dry-run";
    // --include-all is needed because the hotfix sorts after earlier pending files.
    // This command has no apply variant or retry/fallback in this controller.
    const result = cli([
      "db",
      "push",
      "--linked",
      "--project-ref",
      project,
      "--dry-run",
      "--include-all",
      "--skip-vault",
      "--output-format",
      "json",
    ]);
    receipt.pending = verifyDiagnosticDryRun(result.stdout);
    receipt.phase = "ledger-after";
    receipt.after = ledgerDigest(readLedger());
    checkout();
    await authority();
    receipt.phase = "diagnosed";
    receipt.migrationBytes = "740-reviewed";
    record(receipt);
    return receipt;
  } catch {
    receipt.failedPhase = receipt.phase;
    receipt.phase = "diagnostic-failed";
    record(receipt);
    throw new ReleaseCheckError(
      "Read-only CLI diagnostic failed; inspect the sanitized receipt. No apply was attempted.",
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const config = requestFenceDiagnosticConfig(process.env);
    process.stdout.write(
      `${JSON.stringify(await runRequestFenceDiagnostic(config, process.env))}\n`,
    );
  } catch {
    process.stderr.write(
      "Read-only CLI diagnostic refused or failed. No raw provider output was logged.\n",
    );
    process.exitCode = 1;
  }
}
