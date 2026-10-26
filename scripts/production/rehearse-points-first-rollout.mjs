// Fictional local SQL rehearsal. GitHub responses are fixtures, never authority
// to operate on a hosted database. The only executor is the owned Docker DB.
import fs from "node:fs";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { execFileSync, spawnSync, spawn } from "node:child_process";
import { inspectCsfIsolatedWorkDir } from "../local-dev/dv-local-env.mjs";
import {
  bootstrapPlan,
  bootstrapMutationSql,
} from "./request-fence-bootstrap-plan.mjs";
import { applicationRequestWriteFlagSql } from "./request-write-fence.mjs";
import {
  pointsFirstRemainingMigrations,
  pointsFirstRolloutStates,
  pointsFirstRolloutTarget,
} from "./points-first-rollout-catalog.mjs";
import { verifyPointsFirstSource } from "./points-first-rollout-plan.mjs";
import {
  productionPointsFirstConfig,
  runProductionPointsFirst,
} from "./points-first-rollout.mjs";
import { productionRunTarget } from "./production-run-authority.mjs";
import { productionRef } from "./app-release-checks.mjs";

const root = fs.realpathSync(process.cwd());
verifyPointsFirstSource(root);
const source = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
execFileSync("git", ["diff", "--exit-code", "HEAD", "--"], { stdio: "ignore" });
const runId = `pc${randomBytes(6).toString("hex")}`;
const temporaryRoot = fs.realpathSync("/tmp");
const sourceDir = path.join(
  temporaryRoot,
  `lets-assist-points-source-${runId}`,
);
const workDir = path.join(temporaryRoot, `lets-assist-csf-browser-${runId}`);
const directory = path.join(
  root,
  ".artifacts/points-first-controller-rehearsal",
  runId,
);
fs.mkdirSync(sourceDir, { mode: 0o700 });
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const write = (name, value) =>
  fs.writeFileSync(
    path.join(directory, name),
    `${JSON.stringify(value, null, 2)}\n`,
    { mode: 0o600 },
  );
const localEnv = Object.fromEntries(
  [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_CONFIG",
    "XDG_RUNTIME_DIR",
  ]
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]),
);
Object.assign(localEnv, {
  CSF_ISOLATED_RUN_ID: runId,
  CSF_ISOLATED_WORK_DIR: workDir,
  CSF_ISOLATED_BASE_PORT: "26320",
  CSF_ISOLATED_APP_PORT: "3300",
});
const requireCondition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const baseline = new Set(pointsFirstRolloutStates[0].versions);
const sourceHashes = [];
for (const name of fs
  .readdirSync(path.join(root, "supabase/migrations"))
  .filter((name) => name.endsWith(".sql") && baseline.has(name.slice(0, 14)))) {
  const bytes = fs.readFileSync(path.join(root, "supabase/migrations", name));
  const destination = path.join(sourceDir, "supabase/migrations", name);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
  sourceHashes.push({
    name,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
requireCondition(
  sourceHashes.length === 688,
  "The rehearsal baseline is not exact.",
);
fs.cpSync(
  path.join(root, "supabase/templates"),
  path.join(sourceDir, "supabase/templates"),
  { recursive: true },
);
let configBytes = fs.readFileSync(
  path.join(root, "supabase/config.toml"),
  "utf8",
);
const seed = /\[db\.seed\]([\s\S]*?)(?=\n\[|$)/u.exec(configBytes);
requireCondition(
  seed && /^enabled = true$/mu.test(seed[1]),
  "The disposable seed configuration changed.",
);
configBytes = configBytes.replace(
  seed[0],
  seed[0].replace(/^enabled = true$/mu, "enabled = false"),
);
fs.writeFileSync(path.join(sourceDir, "supabase/config.toml"), configBytes, {
  flag: "wx",
  mode: 0o600,
});
write("source.json", {
  format: 1,
  source,
  runId,
  baselineFiles: sourceHashes,
  githubAuthority: "mocked responses only",
  database: "fresh owned local fictional stack",
  hostedAuthorityProved: false,
});
const result = {
  format: 1,
  source,
  runId,
  status: "starting",
  hostedAuthorityProved: false,
  cleanup: "not-started",
};
const runOwned = (script, args, cwd, logName, timeout) =>
  new Promise((resolve) => {
    const log = fs.openSync(path.join(directory, logName), "wx", 0o600);
    const child = spawn("bash", [script, ...args], {
      cwd,
      env: localEnv,
      detached: true,
      stdio: ["ignore", log, log],
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // This is the new process group created immediately above. Stop every
      // launcher child before the canonical resource cleanup can run.
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* Already gone. */
        }
      }
    }, timeout);
    let settled = false;
    const finish = (success) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fs.closeSync(log);
      resolve(success);
    };
    child.once("error", () => finish(false));
    child.once("close", (code) => finish(code === 0 && !timedOut));
  });
const workDeadline = Date.now() + 20 * 60 * 1000;
let launched = false;
try {
  launched = true;
  const started = await runOwned(
    path.join(root, "scripts/local-dev/start-dvhs-csf-isolated-stack.sh"),
    [],
    sourceDir,
    "private-launcher.log",
    5 * 60 * 1000,
  );
  requireCondition(started, "The owned rehearsal launcher failed.");
  const marker = inspectCsfIsolatedWorkDir(workDir);
  requireCondition(
    marker.workDir === workDir &&
      marker.runId === runId &&
      marker.projectId === `lets-assist-csf-browser-${runId}`,
    "The local marker identity changed.",
  );
  const containerName = `supabase_db_${marker.projectId}`;
  const inspect = JSON.parse(
    execFileSync("docker", ["inspect", containerName], { encoding: "utf8" }),
  )[0];
  requireCondition(
    inspect.Config.Labels["com.supabase.cli.project"] === marker.projectId &&
      inspect.Mounts.some(
        (mount) =>
          mount.Type === "volume" && mount.Name === marker.databaseVolume,
      ),
    "The local container ownership changed.",
  );
  const container = inspect.Id;
  const query = (_ignoredUrl, sql) => {
    const remaining = workDeadline - Date.now();
    requireCondition(
      remaining > 0,
      "The rehearsal work deadline expired before cleanup.",
    );
    const response = spawnSync(
      "docker",
      [
        "exec",
        "-i",
        container,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      {
        input: sql,
        encoding: "utf8",
        timeout: Math.min(60_000, remaining),
        maxBuffer: 1024 * 1024,
      },
    );
    if (response.status !== 0 || response.error) {
      fs.writeFileSync(
        path.join(directory, "private-sql-error.log"),
        response.stderr ?? "Local SQL process failed.",
        { mode: 0o600 },
      );
      throw new Error("The owned local SQL refused; private error retained.");
    }
    return response.stdout.trim();
  };
  query(
    null,
    "SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE active;",
  );
  query(
    null,
    bootstrapMutationSql(
      bootstrapPlan(
        root,
        fs.readFileSync,
        pointsFirstRolloutStates[0].versions,
      ),
    ),
  );
  query(null, applicationRequestWriteFlagSql(true));
  const now = Date.now();
  const rehearsalConfig = productionPointsFirstConfig(
    {
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REF: "refs/heads/main",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_REPOSITORY: productionRunTarget.repository,
      GITHUB_REPOSITORY_ID: String(productionRunTarget.repositoryId),
      GITHUB_SHA: source,
      GITHUB_RUN_ID: "456",
      GITHUB_ACTOR: "fictional-operator",
      GH_TOKEN: "fictional-never-used",
      SUPABASE_PROJECT_ID: productionRef,
      SUPABASE_ACCESS_TOKEN: "fictional-never-used",
      SUPABASE_DB_PASSWORD: "fictional-never-used",
      PRODUCTION_DEPLOY_CONFIRMATION: `deploy-production:${productionRef}`,
      APPLICATION_WRITES_BLOCKED_CONFIRMATION: `application-writes-blocked:${source}`,
      EXTERNAL_WRITERS_CONFIRMATION: `external-writers-stopped:${source}`,
      RECOVERY_CAPTURE_SHA256: "b".repeat(64),
      RECOVERY_CAPTURE_CONFIRMATION: `recovery-capture-verified:${source}:${"b".repeat(64)}`,
    },
    root,
  );
  const authority = {
    "": {
      id: productionRunTarget.repositoryId,
      full_name: productionRunTarget.repository,
      default_branch: "main",
    },
    "/git/ref/heads/main": { object: { sha: source } },
    "/environments/production": {
      id: 7,
      name: "Production",
      protection_rules: [
        {
          type: "required_reviewers",
          prevent_self_review: true,
          reviewers: [
            {
              type: "User",
              reviewer: { id: 202, login: "fictional-reviewer" },
            },
          ],
        },
      ],
    },
    "/actions/runs/456": {
      id: 456,
      repository: { id: productionRunTarget.repositoryId },
      event: "workflow_dispatch",
      path: ".github/workflows/deploy-schema.yml",
      head_sha: source,
      head_branch: "main",
      run_attempt: 1,
      status: "in_progress",
      actor: { id: 101, login: "fictional-operator" },
      triggering_actor: { id: 101, login: "fictional-operator" },
      created_at: new Date(now).toISOString(),
    },
    "/collaborators/fictional-operator/permission": { permission: "write" },
    "/actions/runs/456/approvals": [
      {
        state: "approved",
        user: { id: 202, login: "fictional-reviewer" },
        environments: [{ id: 7, name: "Production" }],
      },
    ],
    "/actions/runs/456/jobs?filter=latest&per_page=100": {
      total_count: 1,
      jobs: [
        {
          name: "Require prior Production reconciliations",
          run_id: 456,
          head_sha: source,
          status: "completed",
          conclusion: "success",
        },
      ],
    },
  };
  const dependencies = {
    // This owned Docker rehearsal injects all queries; never resolve a provider route.
    connect: async (config) => ({
      ...config,
      databaseUrl: Object.freeze({
        host: "aws-0-fictional.pooler.supabase.com",
        port: "5432",
        user: `postgres.${productionRef}`,
        database: "postgres",
        sslmode: "require",
        password: "fictional-never-used",
      }),
    }),
    query,
    read: async (key) => {
      requireCondition(
        Object.hasOwn(authority, key),
        "Unexpected mocked authority read.",
      );
      return structuredClone(authority[key]);
    },
    record: (receipt) => {
      write("receipt.json", receipt);
      if (receipt.phase === "migration-verified")
        process.stdout.write(
          `${JSON.stringify({ phase: receipt.phase, count: 689 + receipt.migrations.length })}\n`,
        );
    },
  };
  const plan = await runProductionPointsFirst(
    rehearsalConfig,
    "plan",
    dependencies,
  );
  const expectedRemaining = pointsFirstRemainingMigrations(
    pointsFirstRolloutStates[1].versions,
  );
  requireCondition(
    JSON.stringify(plan.remaining) ===
      JSON.stringify(
        expectedRemaining.map(({ migration, sha256 }) => ({
          migration,
          sha256,
        })),
      ),
    "The local rollout plan changed.",
  );
  const receipt = await runProductionPointsFirst(
    rehearsalConfig,
    "apply",
    dependencies,
  );
  requireCondition(
    receipt.phase === "verified" &&
      receipt.targetMigrations === pointsFirstRolloutTarget.count &&
      receipt.migrations.length === expectedRemaining.length,
    "The controller did not reach its exact target.",
  );
  result.status = `exact-target-${pointsFirstRolloutTarget.count}`;
  result.migrations = receipt.migrations.length;
  result.ledger = receipt.after;
} catch {
  result.status = "unproven";
  process.exitCode = 1;
} finally {
  if (launched && fs.existsSync(workDir)) {
    const stopped = await runOwned(
      path.join(root, "scripts/local-dev/stop-dvhs-csf-isolated-stack.sh"),
      ["--delete-workdir", workDir],
      root,
      "private-cleanup.log",
      90_000,
    );
    result.cleanup = stopped ? "owner-verified" : "unproven";
    if (result.cleanup !== "owner-verified") process.exitCode = 1;
  } else result.cleanup = "no-workdir-created";
  // This process created the exact absent directory above. Retain it if owner
  // cleanup could not prove its Docker resources were removed.
  if (result.cleanup !== "unproven") fs.rmSync(sourceDir, { recursive: true });
  write("result.json", result);
}
process.stdout.write(`${JSON.stringify(result)}\n`);
