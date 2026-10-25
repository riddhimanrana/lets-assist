import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReleaseCheckError } from "../production/app-release-checks.mjs";

export const target = Object.freeze({
  repository: "riddhimanrana/lets-assist",
  repositoryId: 713042374,
  project: "prj_XUDpEktrouxF4dc2VGMegoL00dlE",
  team: "team_CjhwP5Wl7iAhbDrSFJRFxJjE",
  database: "ocbuygudvarsuxijxhau",
  domain: "dev.lets-assist.com",
  branch: "development",
  holdBranch: "codex/development-maintenance-hold",
  // Vercel binds a domain only to a branch that exists. The hold branch is one
  // reviewed orphan commit whose sole vercel.json disables Git deployments and
  // ignores builds, so it can never produce an app deployment.
  holdCommit: "5edf615dcc9d0817680632c0c76f139912cb1f5d",
  holdTree: "993f3b25e5f0ac4100840be7ed62458fb7bef69e",
  workflow: ".github/workflows/csf-hosted-development-acceptance.yml",
});
export const requireCondition = (condition, message) => {
  if (!condition) throw new ReleaseCheckError(message);
};
export const isSha = (value) => /^[a-f0-9]{40}$/u.test(value ?? "");
export const digest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

export function cutoverFailureMessage(error) {
  return error instanceof ReleaseCheckError
    ? error.message
    : "Development cutover failed. Raw output was suppressed.";
}

export function cutoverConfig(env) {
  const config = {
    phase: env.CUTOVER_PHASE,
    candidate: env.ACCEPTED_SHA,
    controller: env.GITHUB_SHA,
    ref: env.GITHUB_REF,
    run: env.GITHUB_RUN_ID,
    actor: env.GITHUB_ACTOR,
    pr: Number(env.CUTOVER_PR_NUMBER),
    prepareRun: env.CUTOVER_PREPARE_RUN_ID,
    githubToken: env.GH_TOKEN,
    vercelToken: env.VERCEL_TOKEN,
    databaseUrl: env.DEVELOPMENT_DATABASE_URL,
    serverKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
    publicKey: env.CSF_DEVELOPMENT_SUPABASE_PUBLISHABLE_KEY,
    bypass: env.VERCEL_AUTOMATION_BYPASS_SECRET,
    cwd: process.cwd(),
  };
  requireCondition(
    env.SUPABASE_PROJECT_ID === target.database &&
      env.SUPABASE_URL === `https://${target.database}.supabase.co`,
    "Development Supabase project or canonical URL does not match the fixed target.",
  );
  requireCondition(
    [
      "inspect",
      "bootstrap",
      "pause-cron",
      "resume-cron",
      "prepare",
      "complete",
      "recover",
    ].includes(config.phase) &&
      isSha(config.candidate) &&
      isSha(config.controller) &&
      env.GITHUB_ACTIONS === "true" &&
      env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.GITHUB_RUN_ATTEMPT === "1" &&
      env.GITHUB_REPOSITORY === target.repository &&
      env.GITHUB_REPOSITORY_ID === String(target.repositoryId) &&
      ([
        "inspect",
        "bootstrap",
        "pause-cron",
        "resume-cron",
        "prepare",
      ].includes(config.phase)
        ? config.controller === config.candidate &&
          config.ref?.startsWith("refs/heads/codex/")
        : config.ref === "refs/heads/development" ||
          (config.phase === "recover" &&
            config.controller === config.candidate &&
            config.ref?.startsWith("refs/heads/codex/"))) &&
      /^[1-9][0-9]*$/u.test(config.run ?? "") &&
      /^[A-Za-z0-9-]+$/u.test(config.actor ?? "") &&
      Number.isSafeInteger(config.pr) &&
      config.pr > 0 &&
      env.CONFIRMATION ===
        `cutover-development:${config.phase}:${config.candidate}` &&
      env.SUPABASE_PROJECT_ID === target.database &&
      env.SUPABASE_URL === `https://${target.database}.supabase.co` &&
      env.VERCEL_ROOT_PROJECT_ID === target.project &&
      env.VERCEL_TEAM_ID === target.team &&
      [
        config.githubToken,
        config.vercelToken,
        config.databaseUrl,
        config.serverKey,
        config.publicKey,
        config.bypass,
      ].every((value) => typeof value === "string" && value.trim()),
    "Development cutover authority or credentials are incomplete.",
  );
  requireCondition(
    config.phase === "inspect"
      ? !config.prepareRun && !env.EXTERNAL_WRITERS_CONFIRMATION
      : ["bootstrap", "pause-cron", "prepare"].includes(config.phase)
        ? !config.prepareRun &&
          env.EXTERNAL_WRITERS_CONFIRMATION ===
            `external-writers-stopped:${config.candidate}`
        : /^[1-9][0-9]*$/u.test(config.prepareRun ?? "") &&
          config.prepareRun !== config.run &&
          (config.phase !== "resume-cron" ||
            env.EXTERNAL_WRITERS_CONFIRMATION ===
              `external-writers-stopped:${config.candidate}`),
    "A candidate-bound external writer hold or prior preparation run is required.",
  );
  return config;
}

// A refused provider request names its error code and a cleaned message, so an
// operator can reconcile it without the raw body. URLs, bearer values and long
// token-like strings are removed; nothing from the request is echoed.
export function sanitizeProviderError(text) {
  let body;
  try {
    body = JSON.parse(String(text ?? "").slice(0, 4096));
  } catch {
    return {};
  }
  const rawCode = body?.error?.code ?? body?.code;
  const rawMessage = body?.error?.message ?? body?.message;
  const code =
    typeof rawCode === "string" && /^[A-Za-z0-9_.-]{1,64}$/u.test(rawCode)
      ? rawCode
      : undefined;
  const message =
    typeof rawMessage === "string"
      ? rawMessage
          .replace(/\p{Cc}+/gu, " ")
          .replace(/https?:\/\/\S+/giu, "[url]")
          .replace(/Bearer\s+\S+/giu, "[redacted]")
          .replace(/[A-Za-z0-9_-]{24,}/gu, "[redacted]")
          .trim()
          .slice(0, 200)
      : undefined;
  return { code, message };
}

async function refusalDetail(response, method) {
  let text = "";
  try {
    text = (await response.text()).slice(0, 4096);
  } catch {
    return "";
  }
  const { code, message } = sanitizeProviderError(text);
  if (!code && !message) return "";
  return ` (${(method || "GET").toUpperCase()}${code ? ` ${code}` : ""}${message ? `: ${message}` : ""})`;
}

export async function jsonRequest(url, token, options = {}, fetcher = fetch) {
  const provider = url.startsWith("https://api.github.com/")
    ? "GitHub"
    : url.startsWith("https://api.vercel.com/")
      ? "Vercel"
      : "Provider";
  const operation = url.includes("/environments/")
    ? "environment policy"
    : url.includes("/collaborators/")
      ? "actor permission"
      : url.includes("/approvals")
        ? "environment review"
        : url.includes("/v9/projects/") && !url.includes("/domains")
          ? "root project"
          : "provider operation";
  let response;
  try {
    response = await fetcher(url, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch {
    throw new ReleaseCheckError(
      `${provider} request transport failed during ${operation}. Reconcile any unknown mutation before retrying. Raw output was suppressed.`,
    );
  }
  if (!response.ok) {
    const detail = await refusalDetail(response, options.method);
    throw new ReleaseCheckError(
      `${provider} request refused (HTTP ${response.status}) during ${operation}${detail}. Reconcile any unknown mutation before retrying. The raw body was suppressed.`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new ReleaseCheckError(
      `${provider} returned invalid JSON during ${operation}. Reconcile any unknown mutation before retrying. Raw output was suppressed.`,
    );
  }
}

export function githubReader(config, fetcher = fetch) {
  return (path) =>
    jsonRequest(
      `https://api.github.com/repos/${target.repository}${path}`,
      config.githubToken,
      {},
      fetcher,
    );
}

export async function verifyAuthority(
  config,
  read,
  receipt,
  { recovery = false } = {},
) {
  const [
    repository,
    environment,
    actor,
    run,
    pr,
    development,
    candidate,
    approvals,
  ] = await Promise.all([
    read(""),
    read("/environments/development"),
    read(`/collaborators/${config.actor}/permission`),
    read(`/actions/runs/${config.run}`),
    read(`/pulls/${config.pr}`),
    read("/git/ref/heads/development"),
    read(`/commits/${config.candidate}`),
    read(`/actions/runs/${config.run}/approvals`),
  ]);
  requireCondition(
    repository.id === target.repositoryId &&
      repository.full_name === target.repository,
    "The repository identity changed.",
  );
  requireCondition(
    environment.name === "development" &&
      environment.protection_rules?.some(
        (rule) =>
          rule.type === "required_reviewers" && rule.reviewers?.length > 0,
      ),
    "Development requires its configured protected environment review before cutover.",
  );
  requireCondition(
    ["write", "maintain", "admin"].includes(actor.permission) &&
      run.event === "workflow_dispatch" &&
      run.head_sha === config.controller &&
      run.path === target.workflow &&
      run.run_attempt === 1 &&
      run.status === "in_progress" &&
      run.actor?.login === config.actor &&
      run.triggering_actor?.login === config.actor &&
      run.repository?.id === target.repositoryId &&
      `refs/heads/${run.head_branch}` === config.ref &&
      candidate.sha === config.candidate &&
      isSha(candidate.commit?.tree?.sha),
    "The cutover workflow or actor is not the reviewed candidate.",
  );
  const reviews = Array.isArray(approvals)
    ? approvals.filter((review) =>
        review.environments?.some(
          (entry) =>
            entry.id === environment.id && entry.name === "development",
        ),
      )
    : [];
  requireCondition(
    reviews.length === 1 &&
      reviews[0].state === "approved" &&
      typeof reviews[0].user?.login === "string" &&
      reviews[0].user.login,
    "This workflow run has no unambiguous approved Development environment review.",
  );
  const reviewerRule = environment.protection_rules.find(
    (rule) => rule.type === "required_reviewers",
  );
  requireCondition(
    reviewerRule.prevent_self_review !== true ||
      reviews[0].user.login.toLowerCase() !== config.actor.toLowerCase(),
    "The current Development policy requires an independent reviewer.",
  );
  requireCondition(
    pr.number === config.pr &&
      pr.head?.sha === config.candidate &&
      pr.head?.repo?.id === target.repositoryId &&
      pr.base?.repo?.id === target.repositoryId &&
      pr.base?.ref === target.branch &&
      pr.head?.ref?.startsWith("codex/") &&
      pr.head.ref !== target.holdBranch,
    "Pull request identity does not match the reviewed Development candidate.",
  );
  // The hold branch must be exactly the pinned sentinel: a moved tip, another
  // tree or a parent could carry a deployable app build onto the held domain.
  const heldRef = await read(`/git/ref/heads/${target.holdBranch}`);
  requireCondition(
    heldRef?.object?.type === "commit" &&
      heldRef.object.sha === target.holdCommit,
    "The maintenance hold branch is not the pinned sentinel commit.",
  );
  const heldCommit = await read(`/git/commits/${target.holdCommit}`);
  requireCondition(
    heldCommit?.sha === target.holdCommit &&
      heldCommit.tree?.sha === target.holdTree &&
      Array.isArray(heldCommit.parents) &&
      heldCommit.parents.length === 0,
    "The maintenance hold branch is not the pinned sentinel tree.",
  );
  if (
    ["inspect", "bootstrap", "pause-cron", "resume-cron", "prepare"].includes(
      config.phase,
    ) &&
    !recovery
  ) {
    requireCondition(
      pr.state === "open" &&
        pr.merged === false &&
        config.controller === config.candidate &&
        pr.head.ref === run.head_branch &&
        pr.base.sha === development.object?.sha,
      "Development or the pull request changed before preparation.",
    );
    const compare = await read(
      `/compare/${development.object.sha}...${config.candidate}`,
    );
    requireCondition(
      ["ahead", "identical"].includes(compare.status) &&
        compare.behind_by === 0,
      "The candidate must contain the current Development head.",
    );
  } else {
    requireCondition(
      receipt?.candidate === config.candidate &&
        receipt.pr === config.pr &&
        receipt.tree === candidate.commit.tree.sha,
      "The preparation receipt belongs to another candidate.",
    );
    if (!recovery || development.object?.sha !== receipt.base) {
      const merged = await read(`/commits/${development.object?.sha}`);
      requireCondition(
        pr.merged === true &&
          config.ref === "refs/heads/development" &&
          config.controller === merged.sha &&
          pr.merge_commit_sha === merged.sha &&
          merged.commit?.tree?.sha === receipt.tree &&
          merged.parents?.length === 2 &&
          merged.parents[0].sha === receipt.base &&
          merged.parents[1].sha === receipt.candidate,
        "Only the exact parent-approved merge of the prepared candidate may complete.",
      );
    } else
      requireCondition(
        config.controller === config.candidate &&
          run.head_branch === pr.head.ref,
        "Pre-merge recovery requires the exact candidate controller.",
      );
  }
  return {
    base: development.object.sha,
    tree: candidate.commit.tree.sha,
    pr: config.pr,
  };
}

export async function loadPreparation(
  config,
  read,
  fetcher = fetch,
  now = Date.now(),
  validate = validateReceipt,
) {
  const run = await read(`/actions/runs/${config.prepareRun}`);
  requireCondition(
    run.event === "workflow_dispatch" &&
      run.path === target.workflow &&
      isSha(run.head_sha) &&
      run.run_attempt === 1 &&
      run.status === "completed" &&
      run.repository?.id === target.repositoryId &&
      (["recover", "resume-cron"].includes(config.phase) ||
        run.conclusion === "success"),
    "The preparation must be an immutable completed run of this candidate workflow.",
  );
  const listing = await read(
    `/actions/runs/${config.prepareRun}/artifacts?per_page=100`,
  );
  const artifacts = listing.artifacts?.filter(
    (artifact) => artifact.name === `development-cutover-${config.prepareRun}`,
  );
  requireCondition(
    listing.total_count <= 100 &&
      artifacts?.length === 1 &&
      Number.isSafeInteger(artifacts[0].id) &&
      artifacts[0].id > 0 &&
      !artifacts[0].expired &&
      /^sha256:[a-f0-9]{64}$/u.test(artifacts[0].digest ?? "") &&
      artifacts[0].size_in_bytes <= 100_000,
    "A unique unexpired GitHub artifact with a SHA256 digest is required.",
  );
  const artifact = artifacts[0];
  let archive;
  try {
    const response = await fetcher(
      `https://api.github.com/repos/${target.repository}/actions/artifacts/${artifact.id}/zip`,
      {
        headers: { Authorization: `Bearer ${config.githubToken}` },
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      },
    );
    const location = new URL(response.headers.get("location"));
    requireCondition(
      response.status === 302 &&
        location.protocol === "https:" &&
        !location.username &&
        !location.password &&
        (location.hostname.endsWith(".blob.core.windows.net") ||
          location.hostname.endsWith(".actions.githubusercontent.com")),
      "Artifact download redirect is not an approved GitHub storage origin.",
    );
    const download = await fetcher(location, {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    requireCondition(
      download.ok,
      "Preparation artifact could not be downloaded.",
    );
    const chunks = [];
    let length = 0;
    for await (const chunk of download.body) {
      length += chunk.length;
      requireCondition(
        length <= 100_000,
        "Preparation artifact exceeds its size bound.",
      );
      chunks.push(chunk);
    }
    archive = Buffer.concat(chunks);
  } catch {
    throw new ReleaseCheckError(
      "Preparation artifact download failed. Raw output was suppressed.",
    );
  }
  requireCondition(
    `sha256:${digest(archive)}` === artifact.digest,
    "Preparation artifact digest differs from GitHub metadata.",
  );
  const directory = mkdtempSync(join(tmpdir(), "lets-assist-cutover-"));
  let receipt;
  try {
    const path = join(directory, "receipt.zip");
    writeFileSync(path, archive, { mode: 0o600 });
    const options = {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 32_768,
      stdio: ["ignore", "pipe", "pipe"],
    };
    requireCondition(
      execFileSync("unzip", ["-Z1", path], options).trim() ===
        "development-cutover.json",
      "Preparation artifact must contain only its receipt.",
    );
    receipt = JSON.parse(
      execFileSync("unzip", ["-p", path, "development-cutover.json"], options),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  validate(receipt, config, now);
  requireCondition(
    run.head_sha === receipt.controller &&
      (receipt.controller === receipt.candidate ||
        receipt.controller === receipt.merged),
    "Artifact controller identity differs from its immutable workflow run.",
  );
  if (receipt.controller !== config.candidate) {
    const [pr, controller, candidate] = await Promise.all([
      read(`/pulls/${config.pr}`),
      read(`/commits/${receipt.controller}`),
      read(`/commits/${config.candidate}`),
    ]);
    requireCondition(
      pr.merged === true &&
        pr.merge_commit_sha === receipt.controller &&
        pr.head?.sha === config.candidate &&
        pr.head?.repo?.id === target.repositoryId &&
        pr.base?.repo?.id === target.repositoryId &&
        pr.base?.ref === target.branch &&
        controller.sha === receipt.controller &&
        controller.parents?.length === 2 &&
        controller.parents[0].sha === receipt.base &&
        controller.parents[1].sha === config.candidate &&
        controller.commit?.tree?.sha === candidate.commit?.tree?.sha &&
        controller.commit?.tree?.sha === receipt.tree,
      "Artifact source is not the independently verified exact candidate merge.",
    );
  }
  return receipt;
}

export function validateReceipt(receipt, config, now = Date.now()) {
  requireCondition(
    receipt?.format === 1 &&
      receipt.candidate === config.candidate &&
      receipt.run === config.prepareRun &&
      receipt.pr === config.pr &&
      receipt.project === target.project &&
      receipt.team === target.team &&
      receipt.database === target.database &&
      receipt.domain === target.domain &&
      receipt.holdBranch === target.holdBranch &&
      isSha(receipt.base) &&
      isSha(receipt.controller) &&
      isSha(receipt.tree) &&
      typeof receipt.observer === "string" &&
      Number.isSafeInteger(receipt.createdAt) &&
      receipt.createdAt <= now &&
      Number.isSafeInteger(receipt.expiresAt) &&
      receipt.expiresAt > receipt.createdAt &&
      receipt.expiresAt - receipt.createdAt <= 4 * 60 * 60 * 1000 &&
      (config.phase === "recover" || receipt.expiresAt > now) &&
      /^dpl_[A-Za-z0-9]+$/u.test(receipt.priorAlias ?? "") &&
      /^dpl_[A-Za-z0-9]+$/u.test(receipt.maintenance?.id ?? "") &&
      /^https:\/\/[a-z0-9-]+\.vercel\.app$/u.test(
        receipt.maintenance?.origin ?? "",
      ) &&
      /^[1-9][0-9]*$/u.test(receipt.maintenanceRun ?? "") &&
      (config.phase === "recover" ||
        receipt.phase === "prepared" ||
        (receipt.phase === "recovered" &&
          receipt.recovery === "maintenance-with-postgrest-request-guard")),
    "Preparation receipt identity, phase or expiry is invalid.",
  );
}
