import { execFileSync } from "node:child_process";
import { ReleaseCheckError } from "./app-release-checks.mjs";

export const productionRunTarget = Object.freeze({
  repository: "riddhimanrana/lets-assist",
  repositoryId: 713042374,
  environment: "production",
});
const requireCondition = (condition, message) => {
  if (!condition) throw new ReleaseCheckError(message);
};
const isProductionEnvironment = (name) =>
  typeof name === "string" &&
  name.toLowerCase() === productionRunTarget.environment;
const workflows = new Set([
  ".github/workflows/production-request-fence-bootstrap.yml",
  ".github/workflows/deploy-schema.yml",
]);

export function productionRunReader(config, fetcher = fetch) {
  return async (path) => {
    try {
      const response = await fetcher(
        `https://api.github.com/repos/${productionRunTarget.repository}${path}`,
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
        "Production authority could not be read. Raw output was suppressed.",
      );
    }
  };
}

export async function verifyProductionRunAuthority(
  config,
  read,
  now = Date.now(),
  workflow,
) {
  requireCondition(
    workflows.has(workflow),
    "The Production workflow is not reviewed.",
  );
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
    repository.id === productionRunTarget.repositoryId &&
      repository.full_name === productionRunTarget.repository &&
      repository.default_branch === "main" &&
      main.object?.sha === config.source &&
      run.id === Number(config.run) &&
      run.repository?.id === productionRunTarget.repositoryId &&
      run.event === "workflow_dispatch" &&
      run.path === workflow &&
      run.head_sha === config.source &&
      run.head_branch === "main" &&
      run.run_attempt === 1 &&
      run.status === "in_progress" &&
      Number.isSafeInteger(run.actor?.id) &&
      run.actor.id > 0 &&
      run.actor?.login === config.actor &&
      run.triggering_actor?.login === config.actor &&
      run.triggering_actor.id === run.actor.id &&
      Number.isFinite(started) &&
      started <= now &&
      now - started <= 4 * 60 * 60 * 1000 &&
      ["write", "maintain", "admin"].includes(actor.permission),
    "Production source, current run or actor authority changed.",
  );
  requireCondition(
    isProductionEnvironment(environment.name) &&
      Number.isSafeInteger(environment.id) &&
      environment.protection_rules?.some(
        (rule) =>
          rule.type === "required_reviewers" && rule.reviewers?.length > 0,
      ),
    "Production requires configured environment reviewers.",
  );
  const reviews = Array.isArray(approvals)
    ? approvals.filter((review) =>
        review.environments?.some(
          (entry) =>
            entry.id === environment.id && isProductionEnvironment(entry.name),
        ),
      )
    : [];
  requireCondition(
    reviews.length === 1 &&
      reviews[0].state === "approved" &&
      Number.isSafeInteger(reviews[0].user?.id) &&
      reviews[0].user.id > 0 &&
      typeof reviews[0].user?.login === "string" &&
      reviews[0].user.login,
    "This exact workflow run lacks an unambiguous approved Production review.",
  );
  const reviewerRule = environment.protection_rules.find(
    (rule) => rule.type === "required_reviewers",
  );
  requireCondition(
    reviewerRule.prevent_self_review !== true ||
      (reviews[0].user.id !== run.actor.id &&
        reviews[0].user.login.toLowerCase() !== config.actor.toLowerCase()),
    "The current Production policy requires an independent reviewer.",
  );
  requireCondition(
    reviewerRule.reviewers.some(
      (entry) =>
        entry.type === "User" &&
        entry.reviewer?.id === reviews[0].user.id &&
        entry.reviewer?.login?.toLowerCase() ===
          reviews[0].user.login.toLowerCase(),
    ),
    "The approved reviewer no longer matches the current Production policy.",
  );
  return { reviewedBy: reviews[0].user.login, environmentId: environment.id };
}

export function verifyProductionCheckout(config, execute = execFileSync) {
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
      "Production requires the clean exact main checkout.",
    );
  }
}
