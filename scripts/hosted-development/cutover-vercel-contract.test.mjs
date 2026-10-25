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

test("the hold refuses any sentinel deployment that is not canceled or failed", async () => {
  for (const state of ["READY", "BLOCKED", "BUILDING", "QUEUED", undefined]) {
    const read = async () => ({
      deployments: [{ uid: "dpl_x", state }],
      pagination: {},
    });
    await assert.rejects(refuseHoldBranchDeployments(read), state ?? "none");
  }
  for (const state of ["CANCELED", "ERROR"]) {
    const read = async (path) => {
      assert.ok(path.includes(`&sha=${target.holdCommit}`));
      return {
        deployments: [{ uid: "dpl_x", readyState: state }],
        pagination: {},
      };
    };
    await refuseHoldBranchDeployments(read);
  }
  await refuseHoldBranchDeployments(async () => ({
    deployments: [],
    pagination: {},
  }));
  await assert.rejects(refuseHoldBranchDeployments(async () => ({})));
});

test("the competing-deployment scan includes blocked deployments", async () => {
  const paths = [];
  await verifyNoCompetingDeployment(async (path) => {
    paths.push(path);
    return { deployments: [], pagination: {} };
  });
  assert.match(paths[0], /state=BUILDING,QUEUED,INITIALIZING,BLOCKED/u);
});

function vercelStub({ alias, domainBranch = target.holdBranch }) {
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
