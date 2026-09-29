import assert from "node:assert/strict";
import test from "node:test";
import {
  previewConfig,
  previewPayload,
  verifyPreview,
  deployExactPreview,
} from "./deploy-exact-preview.mjs";
const env = {
  GITHUB_REF: "refs/heads/development",
  ACCEPTED_SHA: "a".repeat(40),
  DEPLOYED_APP_SHA: "a".repeat(40),
  VERCEL_ROOT_PROJECT_ID: "prj_fixture",
  VERCEL_TEAM_ID: "team_fixture",
  GITHUB_REPOSITORY_ID: "123",
  VERCEL_TOKEN: "fixture",
};
const config = previewConfig(env);
const deployment = {
  id: "dpl_fixture",
  projectId: config.project,
  target: null,
  gitSource: { sha: config.sha, ref: "development", repoId: config.repository },
  meta: { exactDevelopmentSha: config.sha },
  readyState: "READY",
};
const project = {
  id: config.project,
  accountId: config.team,
  link: { type: "github", repoId: config.repository, productionBranch: "main" },
};
const response = (value) => ({ ok: true, json: async () => value });
test("only the exact Development revision can request a Preview", () => {
  for (const change of [
    { GITHUB_REF: "refs/heads/main" },
    { DEPLOYED_APP_SHA: "b".repeat(40) },
    { ACCEPTED_SHA: "development" },
    { VERCEL_TOKEN: "" },
  ])
    assert.throws(() => previewConfig({ ...env, ...change }));
  const payload = previewPayload(config);
  assert.equal(payload.target, undefined);
  assert.equal(payload.gitSource.ref, "development");
  assert.equal(payload.gitSource.sha, config.sha);
  assert.equal(
    payload.build.env.LETS_ASSIST_EXPLICIT_DEVELOPMENT_SHA,
    config.sha,
  );
  assert.equal(payload.env.LETS_ASSIST_EXPLICIT_RELEASE_SHA, undefined);
});
test("Preview receipts reject Production or mismatched source", () => {
  verifyPreview(deployment, config);
  for (const change of [
    { target: "production" },
    { projectId: "prj_other" },
    { gitSource: { ...deployment.gitSource, sha: "b".repeat(40) } },
  ])
    assert.throws(() => verifyPreview({ ...deployment, ...change }, config));
});
test("creates once, records identity, then reads the same deployment", async () => {
  const calls = [],
    receipts = [];
  const result = await deployExactPreview(config, {
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return response(url.includes("/v9/projects/") ? project : deployment);
    },
    record: (r) => receipts.push(r),
  });
  assert.equal(result, "dpl_fixture");
  assert.equal(calls.filter((c) => c.options.method === "POST").length, 1);
  assert.equal(calls.at(-1).url.includes("/dpl_fixture?"), true);
  assert.deepEqual(receipts, [
    { deploymentId: "dpl_fixture", sha: config.sha },
  ]);
});
test("an unknown create outcome is never retried", async () => {
  let posts = 0;
  await assert.rejects(
    deployExactPreview(config, {
      fetcher: async (url, options) => {
        if (options.method === "POST") {
          posts++;
          throw new Error("sensitive provider body");
        }
        return response(project);
      },
    }),
    /outcome is unknown/,
  );
  assert.equal(posts, 1);
});
test("a project with Development as Production cannot deploy", async () => {
  let posts = 0;
  await assert.rejects(
    deployExactPreview(config, {
      fetcher: async (url, options) => {
        if (options.method === "POST") posts++;
        return response({
          ...project,
          link: { ...project.link, productionBranch: "development" },
        });
      },
    }),
    /binding is invalid/,
  );
  assert.equal(posts, 0);
});
