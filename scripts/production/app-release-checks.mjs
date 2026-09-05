import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";

export const productionRef = "fotdmeakexgrkronxlof";
const shaPattern = /^[0-9a-f]{40}$/u;
export class ReleaseCheckError extends Error {}

export function safeFailureMessage(error) {
  return error instanceof ReleaseCheckError
    ? error.message
    : "App-only verification failed. No provider payload or credential was logged.";
}

export function requireSha(value) {
  if (!shaPattern.test(value ?? ""))
    throw new ReleaseCheckError("Invalid release SHA.");
  return value;
}

export async function readJson(url, options, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(url, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ReleaseCheckError("Release verification transport failed.");
  }
  if (!response.ok) {
    throw new ReleaseCheckError(
      `Release verification refused: HTTP ${response.status}.`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new ReleaseCheckError("Release verification returned invalid JSON.");
  }
}

export function verifyAcceptance(status, run, sha, repository) {
  if (
    status?.state !== "success" ||
    status?.creator?.login !== "github-actions[bot]" ||
    status?.target_url !==
      `https://github.com/${repository}/actions/runs/${run?.id}` ||
    run?.path !== ".github/workflows/csf-hosted-development-acceptance.yml" ||
    run?.head_sha !== sha ||
    run?.head_branch !== "development" ||
    run?.repository?.full_name !== repository ||
    run?.head_repository?.full_name !== repository ||
    run?.status !== "completed" ||
    run?.conclusion !== "success" ||
    !["push", "workflow_dispatch"].includes(run?.event)
  )
    throw new ReleaseCheckError(
      "The application has no trusted hosted acceptance.",
    );
}

export function verifyQualityRuns(runs) {
  for (const name of ["quality", "db-replay-validation"]) {
    const matches = runs
      .filter((run) => run.name === name && run.app?.slug === "github-actions")
      .sort((a, b) => b.id - a.id);
    if (
      matches[0]?.status !== "completed" ||
      matches[0]?.conclusion !== "success"
    ) {
      throw new ReleaseCheckError(
        `Required application check is not successful: ${name}.`,
      );
    }
  }
}

export async function verifySource(
  { releaseSha, acceptedSha, repository, token, cwd },
  fetcher = fetch,
) {
  requireSha(releaseSha);
  requireSha(acceptedSha);
  if (!/^[\w.-]+\/[\w.-]+$/u.test(repository ?? "") || !token) {
    throw new ReleaseCheckError(
      "Missing trusted repository verification context.",
    );
  }
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  if (git("rev-parse", "HEAD") !== releaseSha)
    throw new ReleaseCheckError("Checkout SHA differs from release.");
  if (git("status", "--porcelain", "--untracked-files=normal"))
    throw new ReleaseCheckError("Application checkout is not clean.");
  git("merge-base", "--is-ancestor", releaseSha, "origin/main");
  git("merge-base", "--is-ancestor", acceptedSha, releaseSha);
  if (
    git("rev-parse", `${releaseSha}^{tree}`) !==
    git("rev-parse", `${acceptedSha}^{tree}`)
  ) {
    throw new ReleaseCheckError(
      "Application tree differs from hosted acceptance.",
    );
  }
  const request = (path) =>
    readJson(
      `https://api.github.com/repos/${repository}/${path}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      },
      fetcher,
    );
  // The combined-status projection omits creator. Individual statuses retain
  // the author required by verifyAcceptance; do not relax that identity check.
  const statusPayload = await request(
    `commits/${acceptedSha}/statuses?per_page=100`,
  );
  if (!Array.isArray(statusPayload))
    throw new ReleaseCheckError(
      "Hosted acceptance status inventory is invalid.",
    );
  const status = statusPayload
    .filter((item) => item.context === "csf-hosted-development-acceptance")
    .sort((a, b) => b.id - a.id)[0];
  const prefix = `https://github.com/${repository}/actions/runs/`;
  const runId = status?.target_url?.startsWith(prefix)
    ? status.target_url.slice(prefix.length)
    : "";
  if (!/^[0-9]+$/u.test(runId))
    throw new ReleaseCheckError("Hosted acceptance has no trusted run.");
  verifyAcceptance(
    status,
    await request(`actions/runs/${runId}`),
    acceptedSha,
    repository,
  );
  const checks = await request(
    `commits/${acceptedSha}/check-runs?per_page=100`,
  );
  if (checks.total_count > 100)
    throw new ReleaseCheckError(
      "Application checks exceed the bounded inventory.",
    );
  verifyQualityRuns(checks.check_runs ?? []);
  const ciRuns = new Set();
  for (const name of ["quality", "db-replay-validation"]) {
    const check = checks.check_runs
      .filter(
        (item) => item.name === name && item.app?.slug === "github-actions",
      )
      .sort((a, b) => b.id - a.id)[0];
    const match = check.details_url?.startsWith(prefix)
      ? check.details_url.slice(prefix.length).match(/^(\d+)\/job\/\d+$/u)
      : null;
    if (!match)
      throw new ReleaseCheckError(
        "Required CI check has no trusted workflow run.",
      );
    ciRuns.add(match[1]);
  }
  for (const runId of ciRuns) {
    const run = await request(`actions/runs/${runId}`);
    if (
      run.path !== ".github/workflows/ci.yml" ||
      run.head_sha !== acceptedSha ||
      run.repository?.full_name !== repository ||
      run.head_repository?.full_name !== repository ||
      run.status !== "completed" ||
      run.conclusion !== "success"
    ) {
      throw new ReleaseCheckError(
        "Required CI run does not verify the accepted application.",
      );
    }
  }
  return { releaseSha, acceptedSha, tree: git("rev-parse", "HEAD^{tree}") };
}

export function expectedVersions(cwd) {
  const versions = readdirSync(resolve(cwd, "supabase/migrations"))
    .filter((name) => /^\d{14}_.+\.sql$/u.test(name))
    .map((name) => name.slice(0, 14))
    .sort();
  if (!versions.length || new Set(versions).size !== versions.length) {
    throw new ReleaseCheckError("Invalid repository migration inventory.");
  }
  return versions;
}

export function verifyLedger(rows, expected) {
  const actual = rows?.map((row) => row.version);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new ReleaseCheckError(
      "Production migration sequence differs from the accepted application.",
    );
  }
}

export async function verifySchema(
  { projectRef, token, cwd },
  fetcher = fetch,
) {
  if (projectRef !== productionRef || !token)
    throw new ReleaseCheckError("Invalid Production database binding.");
  const query = (sql) =>
    readJson(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query/read-only`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      },
      fetcher,
    );
  const versions = expectedVersions(cwd);
  verifyLedger(
    await query(
      "SELECT version::text FROM supabase_migrations.schema_migrations ORDER BY version;",
    ),
    versions,
  );
  const result = await query(
    acceptedCatalogQuery(
      readFileSync(
        resolve(cwd, "scripts/production/verify-csf-target-schema.sql"),
        "utf8",
      ),
      versions,
    ),
  );
  if (result?.length !== 1 || result[0].csf_target_schema_verified !== 1) {
    throw new ReleaseCheckError("Production CSF catalog verification failed.");
  }
  const preference = await query(`SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
    WHERE p.oid = pg_catalog.to_regprocedure('public.set_csf_staff_view_mode(uuid,text)')
      AND p.prosecdef AND p.proowner = 'postgres'::regrole
      AND p.prorettype = 'void'::regtype
      AND p.proconfig @> ARRAY['search_path=pg_catalog, public, plugin_data, pg_temp', 'row_security=off']
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.prosrc LIKE '%auth.uid()%'
      AND p.prosrc LIKE '%membership.user_id = v_actor_user_id%'
  ) AS valid;`);
  if (preference?.length !== 1 || preference[0].valid !== true)
    throw new ReleaseCheckError(
      "Production staff preference RPC is incompatible.",
    );
  const writePosture = await query(`SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticator'
      AND NOT ('default_transaction_read_only=on' = ANY(coalesce(rolconfig, ARRAY[]::text[])))
  ) AS valid;`);
  if (writePosture?.length !== 1 || writePosture[0].valid !== true)
    throw new ReleaseCheckError(
      "Production has an unresolved application write block.",
    );
  return {
    migrations: versions.length,
    head: versions.at(-1),
    catalog: "verified",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const mode = process.argv[2];
    let receipt;
    if (mode === "source")
      receipt = await verifySource({
        releaseSha: process.env.RELEASE_SHA,
        acceptedSha: process.env.ACCEPTED_SHA,
        repository: process.env.GITHUB_REPOSITORY,
        token: process.env.GH_TOKEN,
        cwd: process.cwd(),
      });
    else if (mode === "schema")
      receipt = await verifySchema({
        projectRef: process.env.SUPABASE_PROJECT_ID,
        token: process.env.SUPABASE_ACCESS_TOKEN,
        cwd: process.cwd(),
      });
    else throw new ReleaseCheckError("Unknown app-only verification mode.");
    console.log(JSON.stringify(receipt));
  } catch (error) {
    console.error(safeFailureMessage(error));
    process.exitCode = 1;
  }
}
