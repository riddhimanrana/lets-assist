import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function previewConfig(env) {
  if (
    env.GITHUB_REF !== "refs/heads/development" ||
    !/^[a-f0-9]{40}$/.test(env.ACCEPTED_SHA ?? "") ||
    env.ACCEPTED_SHA !== env.DEPLOYED_APP_SHA ||
    !/^prj_[A-Za-z0-9]+$/.test(env.VERCEL_ROOT_PROJECT_ID ?? "") ||
    !/^team_[A-Za-z0-9]+$/.test(env.VERCEL_TEAM_ID ?? "") ||
    !/^[1-9][0-9]*$/.test(env.GITHUB_REPOSITORY_ID ?? "") ||
    !env.VERCEL_TOKEN
  )
    throw new Error("An exact current Development build is required.");
  return {
    sha: env.ACCEPTED_SHA,
    project: env.VERCEL_ROOT_PROJECT_ID,
    team: env.VERCEL_TEAM_ID,
    repository: env.GITHUB_REPOSITORY_ID,
    token: env.VERCEL_TOKEN,
  };
}

export function previewPayload(config) {
  const env = {
    LETS_ASSIST_EXPLICIT_DEVELOPMENT_SHA: config.sha,
    LETS_ASSIST_BUILD_SHA: config.sha,
  };
  return {
    name: "lets-assist",
    project: config.project,
    source: "cli",
    gitSource: {
      type: "github",
      repoId: config.repository,
      ref: "development",
      sha: config.sha,
    },
    env,
    build: { env },
    meta: { exactDevelopmentSha: config.sha },
  };
}

export function verifyPreview(deployment, config, id) {
  if (
    !/^dpl_[A-Za-z0-9]+$/.test(deployment?.id ?? "") ||
    deployment.projectId !== config.project ||
    deployment.target !== null ||
    deployment.gitSource?.sha !== config.sha ||
    deployment.gitSource?.ref !== "development" ||
    String(deployment.gitSource?.repoId) !== config.repository ||
    deployment.meta?.exactDevelopmentSha !== config.sha ||
    (id && deployment.id !== id)
  )
    throw new Error(
      "Preview identity differs from the approved Development revision.",
    );
}

export async function deployExactPreview(
  config,
  {
    fetcher = fetch,
    pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    record = () => {},
  } = {},
) {
  const request = async (path, body) => {
    let response;
    try {
      response = await fetcher(
        `https://api.vercel.com${path}?teamId=${config.team}`,
        {
          method: body ? "POST" : "GET",
          redirect: "error",
          signal: AbortSignal.timeout(30000),
          headers: {
            Authorization: `Bearer ${config.token}`,
            "Content-Type": "application/json",
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
    } catch {
      throw new Error(
        "Preview request outcome is unknown. Inspect the existing deployment before retrying.",
      );
    }
    if (!response.ok)
      throw new Error(`Preview request refused HTTP ${response.status}.`);
    try {
      return await response.json();
    } catch {
      throw new Error(
        "Preview response was unreadable. Inspect the existing deployment before retrying.",
      );
    }
  };
  const project = await request(`/v9/projects/${config.project}`);
  if (
    project.id !== config.project ||
    project.accountId !== config.team ||
    project.link?.type !== "github" ||
    String(project.link?.repoId) !== config.repository ||
    project.link?.productionBranch !== "main"
  )
    throw new Error("Preview project binding is invalid.");
  // Create once. A failed response can still have created the deployment.
  const created = await request("/v13/deployments", previewPayload(config));
  verifyPreview(created, config);
  record({ deploymentId: created.id, sha: config.sha });
  for (let attempt = 0; attempt < 100; attempt++) {
    const current = await request(`/v13/deployments/${created.id}`);
    verifyPreview(current, config, created.id);
    if (current.readyState === "READY") return created.id;
    if (!["QUEUED", "INITIALIZING", "BUILDING"].includes(current.readyState))
      throw new Error("The existing Preview build did not reach READY.");
    await pause(15000);
  }
  throw new Error(
    "The Preview is still pending. Reuse the recorded deployment.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const config = previewConfig(process.env);
    const git = (...args) =>
      execFileSync("git", args, { encoding: "utf8" }).trim();
    git("fetch", "--no-tags", "origin", "development");
    if (
      git("rev-parse", "HEAD") !== config.sha ||
      git("rev-parse", "origin/development") !== config.sha
    )
      throw new Error("Development advanced before the Preview request.");
    const id = await deployExactPreview(config, {
      record: (receipt) => {
        mkdirSync(".artifacts", { recursive: true });
        writeFileSync(
          ".artifacts/exact-development-preview.json",
          JSON.stringify(receipt),
        );
      },
    });
    console.log(
      `Exact Development Preview ${id} is READY. Hosted acceptance must still verify its alias and behavior.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
