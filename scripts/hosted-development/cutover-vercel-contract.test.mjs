import assert from "node:assert/strict";
import test from "node:test";
import {
  jsonRequest,
  sanitizeProviderError,
  target,
} from "./cutover-authority.mjs";
import {
  assignHeldAlias,
  holdDomain,
  refuseHoldBranchDeployments,
  verifyHeldAlias,
  verifyNoCompetingDeployment,
} from "./cutover-vercel.mjs";

const token = "tok_" + "a".repeat(40);

test("a refused provider request names its sanitized code and message", async () => {
  const body = JSON.stringify({
    error: {
      code: "invalid_git_branch",
      message: `Branch not found at https://api.vercel.com/v9/x?teamId=t Bearer ${token} ${"z".repeat(30)}`,
    },
  });
  const fetcher = async () => new Response(body, { status: 400 });
  const failure = await jsonRequest(
    `https://api.vercel.com/v9/projects/${target.project}/domains/${target.domain}?teamId=${target.team}`,
    token,
    { method: "PATCH", body: "{}" },
    fetcher,
  ).catch((error) => error);
  assert.match(failure.message, /HTTP 400/u);
  assert.match(failure.message, /PATCH invalid_git_branch: Branch not found/u);
  for (const secret of [token, "https://", "teamId", "Bearer", "z".repeat(30)])
    assert.equal(failure.message.includes(secret), false, secret);
});

test("non-JSON, oversized or unsafe provider bodies fall back cleanly", async () => {
  assert.deepEqual(sanitizeProviderError("<html>oops</html>"), {});
  assert.deepEqual(sanitizeProviderError(""), {});
  const long = sanitizeProviderError(
    JSON.stringify({ error: { code: "a b", message: "x ".repeat(500) } }),
  );
  assert.equal(long.code, undefined);
  assert.ok(long.message.length <= 200);
  assert.deepEqual(
    sanitizeProviderError(`{"error":{"message":"${"y".repeat(5000)}"}}`),
    {},
  );
  const fetcher = async () => new Response("not json", { status: 500 });
  const failure = await jsonRequest(
    "https://api.vercel.com/v13/deployments",
    token,
    {},
    fetcher,
  ).catch((error) => error);
  assert.match(
    failure.message,
    /HTTP 500\) during provider operation\. Reconcile/u,
  );
});

const holdFilters = [
  `&sha=${target.holdCommit}`,
  `&branch=${encodeURIComponent(target.holdBranch)}`,
];
const unsettled = /hold branch deployment is not settled/u;

test("the hold refuses any sentinel or hold branch deployment that is not canceled or failed", async () => {
  for (const filter of holdFilters)
    for (const state of ["READY", "BLOCKED", "BUILDING", "QUEUED", undefined]) {
      const read = async (path) => ({
        deployments: path.includes(filter) ? [{ uid: "dpl_x", state }] : [],
        pagination: {},
      });
      await assert.rejects(refuseHoldBranchDeployments(read), unsettled);
    }
  for (const state of ["CANCELED", "ERROR"]) {
    const paths = [];
    await refuseHoldBranchDeployments(async (path) => {
      paths.push(path);
      return {
        deployments: [{ uid: "dpl_x", readyState: state }],
        pagination: {},
      };
    });
    assert.equal(paths.length, 2);
    holdFilters.forEach((filter, index) =>
      assert.ok(paths[index].includes(filter), filter),
    );
  }
  await assert.rejects(
    refuseHoldBranchDeployments(async () => ({})),
    /inventory is unavailable/u,
  );
});

test("the hold scans follow pagination and keep their page bound", async () => {
  for (const filter of holdFilters) {
    const paths = [];
    const read = async (path) => {
      paths.push(path);
      if (!path.includes(filter)) return { deployments: [], pagination: {} };
      return path.includes("&until=")
        ? { deployments: [{ uid: "dpl_late", state: "READY" }], pagination: {} }
        : { deployments: [], pagination: { next: 1_700_000_000_000 } };
    };
    await assert.rejects(refuseHoldBranchDeployments(read), unsettled);
    assert.ok(
      paths.some(
        (path) =>
          path.includes(filter) && path.endsWith("&until=1700000000000"),
      ),
    );
  }
  let pages = 0;
  await assert.rejects(
    refuseHoldBranchDeployments(async () => {
      pages += 1;
      if (pages > 20) throw new Error("the page bound did not stop the scan");
      return { deployments: [], pagination: { next: 1 } };
    }),
    /exceeds its bound/u,
  );
  assert.equal(pages, 10);
  await assert.rejects(
    refuseHoldBranchDeployments(async () => ({
      deployments: [],
      pagination: { next: "1" },
    })),
    /pagination is invalid/u,
  );
});

test("the competing-deployment scan keeps the live-proven state filter", async () => {
  const paths = [];
  await verifyNoCompetingDeployment(async (path) => {
    paths.push(path);
    return { deployments: [], pagination: {} };
  });
  assert.match(paths[0], /state=BUILDING,QUEUED,INITIALIZING(&|$)/u);
});

function vercelStub({
  alias,
  domainBranch = target.holdBranch,
  holdDeployments = () => [],
}) {
  const writes = [];
  let binding = domainBranch;
  const read = async (path, body, method) => {
    if (body) {
      writes.push({ path, body, method });
      if (path.endsWith(`/domains/${target.domain}`)) binding = body.gitBranch;
      if (path.endsWith("/aliases")) alias = path.split("/")[3];
      return {};
    }
    if (path === `/v9/projects/${target.project}`)
      return {
        id: target.project,
        accountId: target.team,
        link: {
          type: "github",
          repoId: target.repositoryId,
          productionBranch: "main",
        },
      };
    if (path.startsWith(`/v9/projects/${target.project}/domains?`))
      return {
        domains: [
          { name: target.domain, gitBranch: binding },
          { name: "lets-assist.com", gitBranch: null },
        ],
        pagination: {},
      };
    if (path === `/v9/projects/${target.project}/domains/${target.domain}`)
      return { name: target.domain, verified: true, gitBranch: binding };
    if (path === `/v4/aliases/${target.domain}`)
      return {
        alias: target.domain,
        projectId: target.project,
        deploymentId: alias,
      };
    if (
      path.startsWith("/v6/deployments?") &&
      (path.includes(`&sha=${target.holdCommit}`) ||
        path.includes(`&branch=${encodeURIComponent(target.holdBranch)}`))
    )
      return { deployments: holdDeployments(binding), pagination: {} };
    if (path.startsWith("/v6/deployments?"))
      return { deployments: [], pagination: {} };
    throw new Error(`unexpected ${path}`);
  };
  return { read, writes };
}

test("alias assignment writes nothing when the target already holds the alias", async () => {
  const held = vercelStub({ alias: "dpl_Maintenance" });
  await assignHeldAlias(held.read, "dpl_Maintenance", ["dpl_Maintenance"]);
  assert.deepEqual(held.writes, []);
  const moving = vercelStub({ alias: "dpl_Prior" });
  await assignHeldAlias(moving.read, "dpl_Maintenance", ["dpl_Prior"]);
  assert.deepEqual(moving.writes, [
    {
      path: "/v2/deployments/dpl_Maintenance/aliases",
      body: { alias: target.domain },
      method: undefined,
    },
  ]);
});

test("the hold patches exactly the domain branch and nothing else", async () => {
  const s = vercelStub({ alias: "dpl_Prior", domainBranch: target.branch });
  await holdDomain(s.read, "dpl_Prior");
  assert.deepEqual(s.writes, [
    {
      path: `/v9/projects/${target.project}/domains/${target.domain}`,
      body: { gitBranch: target.holdBranch },
      method: "PATCH",
    },
  ]);
});

test("the hold rescans after the domain moves and refuses a hold branch build it triggered", async () => {
  const s = vercelStub({
    alias: "dpl_Prior",
    domainBranch: target.branch,
    holdDeployments: (binding) =>
      binding === target.holdBranch
        ? [{ uid: "dpl_Late", state: "READY" }]
        : [],
  });
  await assert.rejects(holdDomain(s.read, "dpl_Prior"), unsettled);
  assert.equal(s.writes.length, 1);
  assert.equal(s.writes[0].method, "PATCH");
});

test("held alias checks and alias moves refuse a live hold branch deployment", async () => {
  const live = () => [{ uid: "dpl_Late", state: "READY" }];
  const verify = vercelStub({
    alias: "dpl_Maintenance",
    holdDeployments: live,
  });
  await assert.rejects(
    verifyHeldAlias(verify.read, ["dpl_Maintenance"]),
    unsettled,
  );
  const moving = vercelStub({ alias: "dpl_Prior", holdDeployments: live });
  await assert.rejects(
    assignHeldAlias(moving.read, "dpl_Maintenance", ["dpl_Prior"]),
    unsettled,
  );
  assert.deepEqual(moving.writes, []);
});
