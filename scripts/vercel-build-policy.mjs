const DEVELOPMENT_RELEASE_MARKER = "[deploy-development]";
const INTEGRATION_MERGE_PATTERN =
  /^Merge pull request #[1-9][0-9]* from [A-Za-z0-9_.-]+\/codex\/csf-integration-[A-Za-z0-9._/-]+$/u;

function normalizeOptional(value) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function shouldRunVercelBuild({ branch, commitMessage }) {
  const normalizedBranch = normalizeOptional(branch);

  // A non-Git deployment is an explicit operator action. Do not block it.
  if (!normalizedBranch) return true;
  if (normalizedBranch !== "development") return false;

  return isDevelopmentReleaseCommitMessage(commitMessage);
}

export function isDevelopmentReleaseCommitMessage(commitMessage) {
  const normalizedMessage = normalizeOptional(commitMessage) ?? "";
  const firstLine = normalizedMessage.split(/\r?\n/u, 1)[0] ?? "";

  if (firstLine.includes(DEVELOPMENT_RELEASE_MARKER)) return true;

  return INTEGRATION_MERGE_PATTERN.test(firstLine);
}

if (import.meta.main) {
  const shouldBuild = shouldRunVercelBuild({
    branch: process.env.VERCEL_GIT_COMMIT_REF,
    commitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE,
  });

  if (shouldBuild) {
    console.log("Vercel build policy: continue.");
    process.exit(1);
  }

  console.log("Vercel build policy: skip this Git revision.");
  process.exit(0);
}
