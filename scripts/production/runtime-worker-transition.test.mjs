import assert from "node:assert/strict";
import { test } from "node:test";
import {
  transitionConfig,
  transitionWorker,
} from "./runtime-worker-transition.mjs";

const sha = "a".repeat(40);
const env = {
  RELEASE_SHA: sha,
  WORKER: "workbook_refresh",
  WORKER_ENABLED: "true",
  SUPABASE_PROJECT_ID: "fotdmeakexgrkronxlof",
  SUPABASE_ACCESS_TOKEN: "fixture-token",
  VERCEL_AUTOMATION_BYPASS_SECRET: "fixture-automation-bypass",
  GITHUB_RUN_ID: "123",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_ACTOR: "fixture-operator",
  CONFIRMATION: `enable-csf-worker:workbook_refresh:${sha}`,
};
const config = transitionConfig(env);
const off = {
  workbook_refresh: false,
  import_commit: false,
  communications: false,
  scheduled_post_publisher: false,
};
const before = { releaseSha: sha, revision: 0, workers: off };
const after = {
  releaseSha: sha,
  revision: 1,
  requestId: config.requestId,
  workers: { ...off, workbook_refresh: true },
};
function status(controls) {
  return {
    version: sha,
    environment: "production",
    deep: false,
    checks: [
      {
        name: "workers",
        state: "pass",
        details: {
          csfControlMode: "database",
          csfWorkbookRefresh: controls.workers.workbook_refresh,
          csfImportCommit: controls.workers.import_commit,
          csfCommunications: controls.workers.communications,
          csfScheduledPostPublisher: controls.workers.scheduled_post_publisher,
        },
      },
    ],
  };
}
const request = {
  releaseSha: sha,
  worker: "workbook_refresh",
  enabled: true,
  expectedRevision: 0,
  actor: config.actor,
  reason: "Authorized Production worker transition",
};
function transport(responses) {
  const calls = [];
  return {
    calls,
    fetcher: async (url, options) => {
      calls.push({ url, ...options });
      assert.equal(options.redirect, "error");
      const response = responses.shift();
      if (response instanceof Error) throw response;
      assert.notEqual(response, undefined, "unexpected extra request");
      return Response.json(response);
    },
  };
}

test("rejects wrong project, replayed workflow, missing approval and unknown workers", () => {
  for (const change of [
    { SUPABASE_PROJECT_ID: "development" },
    { GITHUB_RUN_ATTEMPT: "2" },
    { CONFIRMATION: "" },
    { WORKER: "all" },
    { WORKER_ENABLED: "yes" },
    { RELEASE_SHA: "main" },
  ]) {
    assert.throws(() => transitionConfig({ ...env, ...change }));
  }
  assert.equal(transitionConfig(env).requestId, config.requestId);
});

test("one mutation records prepared, committed and verified receipts without Vercel writes", async () => {
  const mock = transport([
    [{ controls: before }],
    status(before),
    [{ receipt: after }],
    [{ controls: after }],
    status(after),
  ]);
  const receipts = [];
  assert.deepEqual(
    await transitionWorker(config, mock.fetcher, (r) => receipts.push(r)),
    after,
  );
  assert.deepEqual(
    receipts.map((r) => r.state),
    ["prepared", "committed", "verified"],
  );
  assert.equal(
    mock.calls.filter((r) => r.url.endsWith("/database/query")).length,
    1,
  );
  assert.equal(
    mock.calls.filter((r) => new URL(r.url).hostname === "api.vercel.com")
      .length,
    0,
  );
  assert.equal(mock.calls[1].headers.Authorization, undefined);
  for (const call of mock.calls) {
    const isPublicStatus = new URL(call.url).hostname === "lets-assist.com";
    assert.equal(
      call.headers["x-vercel-protection-bypass"],
      isPublicStatus ? env.VERCEL_AUTOMATION_BYPASS_SECRET : undefined,
    );
    assert.equal(call.url.includes(env.VERCEL_AUTOMATION_BYPASS_SECRET), false);
  }
  assert.equal(
    JSON.stringify(receipts).includes(env.VERCEL_AUTOMATION_BYPASS_SECRET),
    false,
  );
  assert.match(
    JSON.parse(mock.calls[2].body).query,
    /app_private\.set_csf_release_worker_control/u,
  );
});

test("lost mutation response recovers the receipt and never writes twice", async () => {
  const mock = transport([
    [{ controls: before }],
    status(before),
    new Error("lost response"),
    [{ request, receipt: after }],
    [{ controls: after }],
    status(after),
  ]);
  assert.deepEqual(await transitionWorker(config, mock.fetcher), after);
  assert.equal(
    mock.calls.filter((r) => r.url.endsWith("/database/query")).length,
    1,
  );
  assert.match(
    JSON.parse(mock.calls[3].body).query,
    /csf_release_worker_receipts/u,
  );
});

test("unprotected status needs no bypass header and a challenge stops before mutation", async () => {
  const withoutBypass = transitionConfig({
    ...env,
    VERCEL_AUTOMATION_BYPASS_SECRET: "",
  });
  const mock = transport([
    [{ controls: before }],
    status(before),
    [{ receipt: after }],
    [{ controls: after }],
    status(after),
  ]);
  await transitionWorker(withoutBypass, mock.fetcher);
  assert.equal(mock.calls[1].headers["x-vercel-protection-bypass"], undefined);

  const calls = [];
  const receipts = [];
  await assert.rejects(
    transitionWorker(
      config,
      async (url, options) => {
        calls.push({ url, ...options });
        assert.equal(options.redirect, "error");
        return calls.length === 1
          ? Response.json([{ controls: before }])
          : new Response("fixture-challenge", { status: 403 });
      },
      (receipt) => receipts.push(receipt),
    ),
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.endsWith("/database/query/read-only"), true);
  assert.deepEqual(receipts, []);
});

test("unresolved or mismatched recovery receipts stop without another mutation", async () => {
  for (const recovery of [
    [],
    [{ request: { ...request, releaseSha: "b".repeat(40) }, receipt: after }],
  ]) {
    const mock = transport([
      [{ controls: before }],
      status(before),
      new Error("lost response"),
      recovery,
    ]);
    await assert.rejects(transitionWorker(config, mock.fetcher));
    assert.equal(
      mock.calls.filter((r) => r.url.endsWith("/database/query")).length,
      1,
    );
  }
});

test("wrong public SHA or environment mode refuses before mutation", async () => {
  const wrongMode = status(before);
  wrongMode.checks[0].details.csfControlMode = "environment";
  for (const publicStatus of [
    { ...status(before), version: "b".repeat(40) },
    wrongMode,
  ]) {
    const mock = transport([[{ controls: before }], publicStatus]);
    await assert.rejects(transitionWorker(config, mock.fetcher));
    assert.equal(
      mock.calls.filter((r) => r.url.endsWith("/database/query")).length,
      0,
    );
  }
});

test("an unsettled public postcondition keeps the committed receipt", async () => {
  const mock = transport([
    [{ controls: before }],
    status(before),
    [{ receipt: after }],
    [{ controls: after }],
    status(before),
  ]);
  const receipts = [];
  await assert.rejects(
    transitionWorker(config, mock.fetcher, (r) => receipts.push(r)),
  );
  assert.deepEqual(
    receipts.map((r) => r.state),
    ["prepared", "committed"],
  );
  assert.equal(
    mock.calls.filter((r) => r.url.endsWith("/database/query")).length,
    1,
  );
});

test("independent disable preserves unrelated worker flags", async () => {
  const disable = transitionConfig({
    ...env,
    WORKER_ENABLED: "false",
    CONFIRMATION: `disable-csf-worker:workbook_refresh:${sha}`,
  });
  const active = {
    ...after,
    workers: { ...after.workers, import_commit: true },
  };
  const stopped = {
    ...active,
    revision: 2,
    workers: { ...active.workers, workbook_refresh: false },
  };
  const mock = transport([
    [{ controls: active }],
    status(active),
    [{ receipt: stopped }],
    [{ controls: stopped }],
    status(stopped),
  ]);
  assert.equal(
    (await transitionWorker(disable, mock.fetcher)).workers.import_commit,
    true,
  );
});
