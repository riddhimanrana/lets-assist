import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  probeProductionBootstrapApi,
  productionBootstrapConfig,
  productionBootstrapBarrierSql,
  productionBootstrapReader,
  productionBootstrapTarget,
  productionBootstrapVerificationSql,
  runProductionBootstrap,
  verifyProductionBootstrapAuthority,
} from "./bootstrap-request-write-fence.mjs";
import {
  bootstrapPlan,
  bootstrapMutationSql,
} from "./request-fence-bootstrap-plan.mjs";
import { maintenanceLedgerQuery } from "./maintenance-preflight.mjs";
import { pointsFirstRolloutStates } from "./points-first-rollout-catalog.mjs";

const source = "a".repeat(40);
const now = Date.parse("2026-10-07T12:00:00Z");
const cwd = resolve(import.meta.dirname, "../..");
const database = productionBootstrapTarget.database;
function environment() {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_REPOSITORY: productionBootstrapTarget.repository,
    GITHUB_REPOSITORY_ID: String(productionBootstrapTarget.repositoryId),
    GITHUB_SHA: source,
    ACCEPTED_MAIN_SHA: source,
    GITHUB_RUN_ID: "456",
    GITHUB_ACTOR: "operator",
    GH_TOKEN: "synthetic-github",
    SUPABASE_PROJECT_ID: database,
    SUPABASE_ACCESS_TOKEN: "synthetic-access-token",
    SUPABASE_DB_PASSWORD: "synthetic-db-password",
    SUPABASE_SECRET_KEY: "synthetic-server",
    PRODUCTION_BOOTSTRAP_CONFIRMATION: `bootstrap-production:${database}:${source}`,
    EXTERNAL_WRITERS_CONFIRMATION: `external-writers-stopped:${source}`,
  };
}
function authorityFixture() {
  return {
    "": {
      id: productionBootstrapTarget.repositoryId,
      full_name: productionBootstrapTarget.repository,
      default_branch: "main",
    },
    "/git/ref/heads/main": { object: { sha: source } },
    "/environments/production": {
      id: 7,
      name: "production",
      protection_rules: [
        {
          type: "required_reviewers",
          reviewers: [
            { type: "User", reviewer: { id: 202, login: "reviewer" } },
          ],
        },
      ],
    },
    "/actions/runs/456": {
      id: 456,
      repository: { id: productionBootstrapTarget.repositoryId },
      event: "workflow_dispatch",
      path: productionBootstrapTarget.workflow,
      head_sha: source,
      head_branch: "main",
      run_attempt: 1,
      status: "in_progress",
      actor: { id: 101, login: "operator" },
      triggering_actor: { id: 101, login: "operator" },
      created_at: new Date(now - 60_000).toISOString(),
    },
    "/collaborators/operator/permission": { permission: "write" },
    "/actions/runs/456/approvals": [
      {
        state: "approved",
        user: { id: 202, login: "reviewer" },
        environments: [{ id: 7, name: "production" }],
      },
    ],
  };
}
const config = () => productionBootstrapConfig(environment(), cwd);

test("config requires exact main, fixed Production owner and source-bound confirmations", () => {
  assert.equal(config().databasePassword, "synthetic-db-password");
  assert.equal(config().databaseUrl, undefined);
  for (const [key, value] of Object.entries({
    GITHUB_ACTIONS: "false",
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: "refs/heads/development",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_REPOSITORY: "other/repository",
    GITHUB_REPOSITORY_ID: "1",
    GITHUB_SHA: "short",
    ACCEPTED_MAIN_SHA: "b".repeat(40),
    GITHUB_RUN_ID: "0",
    GITHUB_ACTOR: "bad/path",
    GH_TOKEN: "",
    SUPABASE_PROJECT_ID: "ocbuygudvarsuxijxhau",
    SUPABASE_SECRET_KEY: "",
    SUPABASE_ACCESS_TOKEN: "",
    SUPABASE_DB_PASSWORD: "",
    PRODUCTION_BOOTSTRAP_CONFIRMATION: `bootstrap-production:${database}`,
    EXTERNAL_WRITERS_CONFIRMATION: "yes",
  }))
    assert.throws(
      () => productionBootstrapConfig({ ...environment(), [key]: value }, cwd),
      key,
    );
  for (const password of [" ", "bad\npassword", "bad\0password"]) {
    assert.throws(() =>
      productionBootstrapConfig(
        { ...environment(), SUPABASE_DB_PASSWORD: password },
        cwd,
      ),
    );
  }
  const withoutOldConnection = environment();
  const legacy = new URL("postgresql://ignored.invalid/ignored");
  legacy.username = "ignored";
  legacy.password = withoutOldConnection.SUPABASE_DB_PASSWORD;
  legacy.searchParams.set("sslmode", "verify-full");
  withoutOldConnection.PRODUCTION_BOOTSTRAP_DATABASE_URL = legacy.href;

  assert.equal(
    productionBootstrapConfig(withoutOldConnection, cwd).databaseUrl,
    undefined,
  );
});

test("authority accepts only the current protected run's actual approved review", async () => {
  const fixture = authorityFixture();
  assert.deepEqual(
    await verifyProductionBootstrapAuthority(
      config(),
      async (path) => fixture[path],
      now,
    ),
    { reviewedBy: "reviewer", environmentId: 7 },
  );
  for (const mutate of [
    (f) => {
      f["/git/ref/heads/main"].object.sha = "b".repeat(40);
    },
    (f) => {
      f[""].default_branch = "development";
    },
    (f) => {
      f["/environments/production"].protection_rules = [];
    },
    (f) => {
      f["/actions/runs/456"].event = "push";
    },
    (f) => {
      f["/actions/runs/456"].id = 457;
    },
    (f) => {
      f["/actions/runs/456"].head_sha = "b".repeat(40);
    },
    (f) => {
      f["/actions/runs/456"].path = ".github/workflows/deploy-schema.yml";
    },
    (f) => {
      f["/actions/runs/456"].run_attempt = 2;
    },
    (f) => {
      f["/actions/runs/456"].status = "completed";
    },
    (f) => {
      f["/actions/runs/456"].triggering_actor.login = "another";
    },
    (f) => {
      f["/actions/runs/456"].created_at = new Date(
        now - 5 * 60 * 60 * 1000,
      ).toISOString();
    },
    (f) => {
      f["/collaborators/operator/permission"].permission = "read";
    },
    (f) => {
      f["/actions/runs/456/approvals"] = [];
    },
    (f) => {
      f["/actions/runs/456/approvals"][0].state = "rejected";
    },
    (f) => {
      f["/actions/runs/456/approvals"][0].environments[0].id = 8;
    },
    (f) => {
      f["/actions/runs/456/approvals"].push(
        f["/actions/runs/456/approvals"][0],
      );
    },
  ]) {
    const bad = authorityFixture();
    mutate(bad);
    await assert.rejects(
      verifyProductionBootstrapAuthority(
        config(),
        async (path) => bad[path],
        now,
      ),
    );
  }
});

test("authority refresh refuses a revoked review after a previously approved read", async () => {
  const fixture = authorityFixture();
  const read = async (path) => fixture[path];
  await verifyProductionBootstrapAuthority(config(), read, now);
  fixture["/actions/runs/456/approvals"][0].state = "rejected";
  await assert.rejects(
    verifyProductionBootstrapAuthority(config(), read, now),
    /approved Production review/u,
  );
});

test("authority preserves Production identity casing and the current independent-review rule", async () => {
  const fixture = authorityFixture();
  fixture["/environments/production"].name = "Production";
  fixture["/actions/runs/456/approvals"][0].environments[0].name = "Production";
  const rule = fixture["/environments/production"].protection_rules[0];
  rule.prevent_self_review = false;
  rule.reviewers.push({
    type: "User",
    reviewer: { id: 101, login: "operator" },
  });
  fixture["/actions/runs/456/approvals"][0].user = {
    id: 101,
    login: "operator",
  };
  await verifyProductionBootstrapAuthority(
    config(),
    async (key) => fixture[key],
    now,
  );
  rule.prevent_self_review = true;
  await assert.rejects(
    verifyProductionBootstrapAuthority(
      config(),
      async (key) => fixture[key],
      now,
    ),
    /independent reviewer/u,
  );
  fixture["/actions/runs/456/approvals"][0].user = {
    id: 202,
    login: "reviewer",
  };
  await verifyProductionBootstrapAuthority(
    config(),
    async (key) => fixture[key],
    now,
  );
  fixture["/actions/runs/456/approvals"][0].environments[0].name =
    "development";
  await assert.rejects(
    verifyProductionBootstrapAuthority(
      config(),
      async (key) => fixture[key],
      now,
    ),
  );
});

test("API probes use fixed origin, contradictory zero-row filters and no redirects", async () => {
  for (const write of [false, true]) {
    let calls = 0;
    await probeProductionBootstrapApi(
      config(),
      async (url, options) => {
        calls++;
        assert.equal(new URL(url).origin, `https://${database}.supabase.co`);
        assert.equal(new URL(url).pathname, "/rest/v1/system_banners");
        assert.equal(
          new URL(url).searchParams.get("and"),
          "(id.eq.00000000-0000-0000-0000-000000000000,id.neq.00000000-0000-0000-0000-000000000000)",
        );
        assert.equal(options.method, write ? "PATCH" : "GET");
        assert.equal(options.redirect, "error");
        assert.equal(options.cache, "no-store");
        assert.equal(options.headers.apikey, "synthetic-server");
        assert.equal(options.body, write ? '{"is_active":false}' : undefined);
        return new Response(write ? null : "[]", { status: write ? 204 : 200 });
      },
      write,
    );
    assert.equal(calls, 1);
    await assert.rejects(
      probeProductionBootstrapApi(
        config(),
        async () => new Response("secret output", { status: 403 }),
        write,
      ),
      (error) => !error.message.includes("secret output"),
    );
  }
  await assert.rejects(
    probeProductionBootstrapApi(
      config(),
      async () => new Response('[{"id":"unexpected"}]'),
    ),
  );
  await assert.rejects(
    probeProductionBootstrapApi(config(), async () => {
      throw new Error("credential sentinel");
    }),
    (error) => !error.message.includes("credential sentinel"),
  );
});

test("authority reader uses only fixed GitHub origin and suppresses response data", async () => {
  const read = productionBootstrapReader(config(), async (url, options) => {
    assert.equal(
      url,
      `https://api.github.com/repos/${productionBootstrapTarget.repository}/environments/production`,
    );
    assert.equal(options.redirect, "error");
    return new Response('{"name":"production"}');
  });
  assert.deepEqual(await read("/environments/production"), {
    name: "production",
  });
  await assert.rejects(
    productionBootstrapReader(
      config(),
      async () => new Response("secret", { status: 403 }),
    )(""),
    (error) => !error.message.includes("secret"),
  );
});

function controllerFixture({ pointsFirst = false } = {}) {
  // The real accepted plan and generated SQL are mandatory. Unknown catalog
  // versions cannot become accepted through a test-only migration fixture.
  const plan = bootstrapPlan(
    cwd,
    readFileSync,
    pointsFirst ? pointsFirstRolloutStates[0].versions : undefined,
  );
  const fixture = authorityFixture();
  const state = {
    applied: plan.before,
    links: 0,
    writes: 0,
    authorityReads: 0,
    verifications: 0,
    barriers: 0,
    probes: [],
    receipts: [],
    lost: false,
    rollback: false,
    failCatalog: false,
    failProbe: false,
    failWriteProbe: false,
    failBarrier: false,
    moveMainAt: 0,
    revokeReviewAt: 0,
    failVerificationAt: 0,
  };
  const expectedMutation = bootstrapMutationSql(plan);
  const dependencies = {
    now: () => now,
    link: () => {
      assert.ok(state.authorityReads > 0);
      state.links++;
      return { transport: "synthetic-linked" };
    },
    record: (receipt) => state.receipts.push(receipt),
    execute: (command, args) => {
      assert.equal(command, "git");
      if (JSON.stringify(args) === JSON.stringify(["rev-parse", "HEAD"]))
        return `${source}\n`;
      assert.deepEqual(args, ["diff", "--exit-code", "HEAD", "--"]);
      return "";
    },
    read: async (path) => {
      if (path === "") state.authorityReads++;
      if (
        path === "/git/ref/heads/main" &&
        state.authorityReads === state.moveMainAt
      )
        return { object: { sha: "b".repeat(40) } };
      if (
        path === "/actions/runs/456/approvals" &&
        state.authorityReads === state.revokeReviewAt
      )
        return [{ ...fixture[path][0], state: "rejected" }];
      assert.ok(Object.hasOwn(fixture, path));
      return fixture[path];
    },
    fetcher: async (_url, options) => {
      state.probes.push(options.method);
      if (options.method === "PATCH") assert.equal(state.barriers, 1);
      if (
        state.failProbe ||
        (state.failWriteProbe && options.method === "PATCH")
      )
        return new Response("refused", { status: 403 });
      return new Response(options.method === "GET" ? "[]" : null, {
        status: options.method === "GET" ? 200 : 204,
      });
    },
    query: (connection, sql, password) => {
      assert.deepEqual(connection, { transport: "synthetic-linked" });
      assert.equal(password, "synthetic-db-password");
      if (sql === maintenanceLedgerQuery) return JSON.stringify(state.applied);
      if (sql === productionBootstrapBarrierSql) {
        state.barriers++;
        if (state.failBarrier) throw new Error("request barrier timed out");
        return "production-bootstrap-requests-settled";
      }
      if (sql === expectedMutation) {
        state.writes++;
        if (!state.rollback) state.applied = plan.after;
        if (state.lost || state.rollback)
          throw new Error("suppressed transport failure");
        return "request-fence-bootstrap-applied";
      }
      assert.equal(sql, productionBootstrapVerificationSql(state.applied));
      state.verifications++;
      if (state.failCatalog || state.verifications === state.failVerificationAt)
        throw new Error("catalog refusal");
      return "production-bootstrap-verified";
    },
  };
  return { plan, fixture, state, dependencies };
}

test("linked routing failure occurs after authority but before SQL or API probes and stays sanitized", async () => {
  const { state, dependencies } = controllerFixture();
  dependencies.link = async () => {
    assert.equal(state.authorityReads, 1);
    state.links++;
    throw new Error("raw-provider-output synthetic-access-token");
  };
  await assert.rejects(
    runProductionBootstrap(config(), dependencies),
    (error) =>
      !/raw-provider-output|synthetic-access-token/u.test(error.message),
  );
  assert.equal(state.links, 1);
  assert.equal(state.writes, 0);
  assert.equal(state.verifications, 0);
  assert.deepEqual(state.probes, []);
  assert.equal(state.receipts.at(-1).phase, "unproven");
  assert.equal(
    state.receipts.at(-1).transport,
    "management-metadata-session-psql",
  );
});

test("controller applies only the real atomic bootstrap and proves open API state", async () => {
  const { state, dependencies } = controllerFixture();
  const receipt = await runProductionBootstrap(config(), dependencies);
  assert.equal(state.writes, 1);
  assert.deepEqual(state.probes, ["GET", "GET", "PATCH"]);
  assert.equal(receipt.phase, "verified");
  assert.equal(receipt.migrations, 688);
  assert.equal(receipt.requestFence, "installed-disabled");
  assert.equal(receipt.mutation, "acknowledged");
  assert.equal(receipt.preexistingRequests, "settled");
  assert.equal(state.barriers, 1);
  assert.equal(state.authorityReads, 3);
  assert.equal(state.verifications, 3);
  assert.equal(state.receipts[0].phase, "mutation-started");
  assert.ok(!JSON.stringify(receipt).includes("synthetic-server"));
  assert.ok(!JSON.stringify(receipt).includes("synthetic-test-value"));
});

test("controller reconciles applied688 without writes and lost responses without repeating mutation", async () => {
  for (const already of [false, true]) {
    const { plan, state, dependencies } = controllerFixture();
    if (already) state.applied = plan.after;
    else state.lost = true;
    const result = await runProductionBootstrap(config(), dependencies);
    assert.equal(state.writes, already ? 0 : 1);
    assert.equal(state.barriers, 1);
    assert.equal(result.preexistingRequests, "settled");
    assert.equal(
      result.mutation,
      already ? "already-applied" : "verified-after-unknown-response",
    );
  }
});

test("points-first controller names the fence and reconciles only its exact 689 state", async () => {
  for (const mode of ["apply", "already", "unknown-response"]) {
    const { plan, state, dependencies } = controllerFixture({
      pointsFirst: true,
    });
    if (mode === "already") state.applied = plan.after;
    if (mode === "unknown-response") state.lost = true;
    const receipt = await runProductionBootstrap(config(), dependencies);
    assert.equal(state.writes, mode === "already" ? 0 : 1);
    assert.equal(receipt.phase, "verified");
    assert.equal(receipt.bootstrapPath, "points-first-688-to-689");
    assert.equal(receipt.migrations, 689);
    assert.equal(receipt.migration.version, "20260929051600");
    assert.equal(receipt.head, "20261013071100");
    assert.equal(state.barriers, 1);
    assert.deepEqual(state.probes, ["GET", "GET", "PATCH"]);
  }
});

test("controller refuses incomplete request drain after committed or already-applied bootstrap", async () => {
  for (const mode of ["acknowledged", "unknown", "already-applied"]) {
    const { plan, state, dependencies } = controllerFixture();
    if (mode === "already-applied") state.applied = plan.after;
    if (mode === "unknown") state.lost = true;
    state.failBarrier = true;
    await assert.rejects(runProductionBootstrap(config(), dependencies));
    assert.deepEqual(state.applied, plan.after);
    assert.equal(state.writes, mode === "already-applied" ? 0 : 1);
    assert.equal(state.barriers, 1);
    assert.deepEqual(state.probes, ["GET"]);
    assert.equal(state.receipts.at(-1).phase, "unproven");
    assert.ok(!state.receipts.some((receipt) => receipt.phase === "verified"));
  }
});

test("controller refuses changed authority, drift and bad credentials before writes", async () => {
  for (const mutation of [
    ({ state }) => {
      state.moveMainAt = 1;
    },
    ({ state }) => {
      state.moveMainAt = 2;
    },
    ({ fixture }) => {
      fixture["/actions/runs/456/approvals"] = [];
    },
    ({ state }) => {
      state.revokeReviewAt = 2;
    },
    ({ state }) => {
      state.failCatalog = true;
    },
    ({ state }) => {
      state.failProbe = true;
    },
    ({ state }) => {
      state.applied = [...state.applied, "20990101000000"];
    },
    ({ dependencies }) => {
      dependencies.execute = () => {
        throw new Error("dirty");
      };
    },
  ]) {
    const testCase = controllerFixture();
    mutation(testCase);
    await assert.rejects(
      runProductionBootstrap(config(), testCase.dependencies),
    );
    assert.equal(testCase.state.writes, 0);
  }
});

test("controller keeps an unproven receipt after rollback, late drift or changed main", async () => {
  for (const mutation of [
    ({ state }) => {
      state.rollback = true;
    },
    ({ state }) => {
      state.failVerificationAt = 2;
    },
    ({ state }) => {
      state.failWriteProbe = true;
    },
    ({ state }) => {
      state.moveMainAt = 3;
    },
    ({ state }) => {
      state.revokeReviewAt = 3;
    },
  ]) {
    const testCase = controllerFixture();
    mutation(testCase);
    await assert.rejects(
      runProductionBootstrap(config(), testCase.dependencies),
    );
    assert.equal(testCase.state.writes, 1);
    assert.equal(testCase.state.receipts.at(-1).phase, "unproven");
    assert.ok(
      !testCase.state.receipts.some((receipt) => receipt.phase === "verified"),
    );
  }
});

test("workflow is manual, protected and shares the Production schema lock", () => {
  const workflow = readFileSync(
    resolve(cwd, productionBootstrapTarget.workflow),
    "utf8",
  );
  const deploy = readFileSync(
    resolve(cwd, ".github/workflows/deploy-schema.yml"),
    "utf8",
  );
  for (const text of [
    "workflow_dispatch:",
    "environment: production",
    "github.ref == 'refs/heads/main'",
    "group: production-schema-deployment",
    "cancel-in-progress: false",
    "persist-credentials: false",
    "ref: ${{ github.sha }}",
    "actions: read",
    "contents: read",
    "deployments: read",
    "timeout-minutes: 20",
    "if: always()",
  ])
    assert.ok(workflow.includes(text), text);
  assert.ok(deploy.includes("group: production-schema-deployment"));
  const install = workflow
    .split("- name: Verify approval and install the additive guard")[1]
    .split("- name: Preserve")[0];
  assert.match(
    install,
    /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets.SUPABASE_ACCESS_TOKEN \}\}/u,
  );
  assert.match(
    install,
    /SUPABASE_DB_PASSWORD: \$\{\{ secrets.SUPABASE_DB_PASSWORD \}\}/u,
  );
  assert.match(install, /PRODUCTION_BOOTSTRAP_DATABASE_URL/u);
  assert.ok(
    !/\n {2}(push|pull_request|schedule|workflow_call):/u.test(workflow),
  );
  assert.ok(
    !/secrets: inherit|permissions: write-all|VERCEL_TOKEN|supabase db push|set-application-write-block/u.test(
      workflow,
    ),
  );
  assert.equal(
    (
      workflow.match(
        /run: node scripts\/production\/bootstrap-request-write-fence\.mjs/gu,
      ) ?? []
    ).length,
    1,
  );
  const controller = readFileSync(
    new URL("./bootstrap-request-write-fence.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(controller.includes('from "./request-fence-bootstrap-plan.mjs"'));
  assert.ok(
    !/ALTER ROLE|cron\.alter_job|DELETE FROM|db push|setWriteBlock|assignHeldAlias/u.test(
      controller,
    ),
  );
});
