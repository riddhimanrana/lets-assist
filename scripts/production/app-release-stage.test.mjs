import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createStage,
  stageConfig,
  stagePayload,
  validateStage,
  waitForStage,
} from "./app-release-stage.mjs";

const config = stageConfig({
  RELEASE_SHA: "a".repeat(40),
  ACCEPTED_SHA: "b".repeat(40),
  GITHUB_SHA: "c".repeat(40),
  VERCEL_ROOT_PROJECT_ID: "prj_fixture",
  VERCEL_TEAM_ID: "team_fixture",
  EXPECTED_GITHUB_REPOSITORY_ID: "123",
  VERCEL_TOKEN: "fictional-test-token",
  GITHUB_RUN_ID: "456",
});
function fixture(overrides = {}) {
  return {
    id: "dpl_fixture",
    url: "fixture.vercel.app",
    projectId: config.project,
    target: "production",
    readyState: "READY",
    aliasAssigned: false,
    alias: [],
    gitSource: { sha: config.release, repoId: config.repository },
    meta: { appOnlyReleaseSha: config.release, appOnlyReleaseRun: config.run },
    ...overrides,
  };
}

test("build stays with Vercel secrets and disables workers in both environments", () => {
  const payload = stagePayload(config);
  assert.equal(payload.autoAssignCustomDomains, false);
  assert.deepEqual(payload.gitSource, {
    type: "github",
    ref: config.release,
    sha: config.release,
    repoId: config.repository,
  });
  assert.equal(payload.target, "production");
  assert.equal(payload.ignoreCommand, "exit 1");
  assert.equal(payload.projectSettings, undefined);
  assert.deepEqual(payload.env, payload.build.env);
  assert.equal(
    Object.entries(payload.env).filter(
      ([key, value]) => key.startsWith("CSF_") && value === "false",
    ).length,
    4,
  );
  assert.equal(payload.env.LETS_ASSIST_BUILD_SHA, config.release);
  assert.doesNotMatch(
    JSON.stringify(payload),
    /fictional-test-token|SUPABASE|\[SENSITIVE\]/u,
  );
});

test("create sends exactly one scoped POST and never retries an unknown result", async () => {
  let calls = 0;
  await assert.rejects(
    createStage(config, async (url, options) => {
      calls++;
      assert.equal(
        url,
        "https://api.vercel.com/v13/deployments?teamId=team_fixture",
      );
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "error");
      throw new Error("provider-secret-response");
    }),
    /outcome is unknown/u,
  );
  assert.equal(calls, 1);
  const staged = await createStage(config, async () =>
    Response.json(fixture()),
  );
  assert.deepEqual(staged, {
    deployment_id: "dpl_fixture",
    origin: "https://fixture.vercel.app",
  });
});

test("polling only reads the recorded deployment and never creates a replacement", async () => {
  let calls = 0;
  await waitForStage(
    config,
    "dpl_fixture",
    async (url, options) => {
      assert.equal(
        url,
        "https://api.vercel.com/v13/deployments/dpl_fixture?teamId=team_fixture",
      );
      assert.equal(options.method, "GET");
      return Response.json(
        fixture({ readyState: calls++ ? "READY" : "BUILDING" }),
      );
    },
    async () => {},
  );
  assert.equal(calls, 2);
  for (const readyState of ["ERROR", "CANCELED", "BLOCKED", "unknown"]) {
    await assert.rejects(
      waitForStage(
        config,
        "dpl_fixture",
        async () => Response.json(fixture({ readyState })),
        async () => {},
      ),
    );
  }
});

test("stage identity refuses wrong source, tenant, target, run, or public alias", () => {
  for (const overrides of [
    { projectId: "prj_other" },
    { target: "preview" },
    { id: "invalid" },
    { url: "attacker.test" },
    { gitSource: { sha: "d".repeat(40), repoId: "123" } },
    { gitSource: { sha: config.release, repoId: "987" } },
    { meta: { appOnlyReleaseSha: config.release, appOnlyReleaseRun: "987" } },
    { aliasAssigned: true },
    { aliasAssigned: "true" },
    { alias: ["lets-assist.com"] },
    { alias: "lets-assist.com" },
  ])
    assert.throws(() =>
      validateStage(fixture(overrides), config, "dpl_fixture"),
    );
  assert.throws(() => validateStage(fixture(), config, "dpl_other"));
});

test("provider errors never expose response content", async () => {
  await assert.rejects(
    createStage(
      config,
      async () => new Response("private-provider-value", { status: 403 }),
    ),
    (error) => {
      assert.match(error.message, /HTTP 403/u);
      assert.doesNotMatch(error.message, /private-provider-value/u);
      return true;
    },
  );
});
