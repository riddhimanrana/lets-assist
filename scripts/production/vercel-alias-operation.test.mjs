import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const verifier = fileURLToPath(
  new URL("./verify-vercel-alias-operation.sh", import.meta.url),
);

async function verify({
  alias = "dpl_expected",
  ready = "READY",
  project = "prj_expected",
  operations = [null],
  deploymentAliases = [],
  aliases = [alias],
  direct = false,
  verificationTimeout = "5",
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "csf-alias-operation-"));
  writeFileSync(
    join(dir, "curl"),
    `#!/usr/bin/env node
const fs = require('node:fs');
const url = process.argv.find(value => value.startsWith('https://'));
fs.appendFileSync(process.env.REQUEST_LOG, url + '\\n');
if (url.includes('/v9/projects/')) {
  const path = process.env.REQUEST_LOG + '.count';
  const count = fs.existsSync(path) ? Number(fs.readFileSync(path, 'utf8')) : 0;
  fs.writeFileSync(path, String(count + 1));
  const operations = JSON.parse(process.env.FAKE_OPERATIONS);
  console.log(JSON.stringify({id:process.env.FAKE_PROJECT,accountId:'team_expected',lastAliasRequest:operations[Math.min(count,operations.length - 1)]}));
} else if (url.includes('/v4/aliases')) {
  const path = process.env.REQUEST_LOG + '.alias-count';
  const count = fs.existsSync(path) ? Number(fs.readFileSync(path, 'utf8')) : 0;
  fs.writeFileSync(path, String(count + 1));
  const aliases = JSON.parse(process.env.FAKE_ALIASES);
  const alias = aliases[Math.min(count,aliases.length - 1)];
  if (alias === 'network_error') process.exit(22);
  if (alias === 'malformed') { console.log('{'); process.exit(0); }
  console.log(JSON.stringify({aliases:[{alias:'lets-assist.com',projectId:'prj_expected',deploymentId:alias}]}));
} else if (url.includes('/v13/deployments/')) {
  console.log(JSON.stringify({id:'dpl_expected',projectId:'prj_expected',target:'production',readyState:process.env.FAKE_READY,aliasAssigned:true,alias:JSON.parse(process.env.FAKE_DEPLOYMENT_ALIASES)}));
} else process.exit(22);
`,
    { mode: 0o755 },
  );
  try {
    const env = {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      EXPECTED_ALIAS_OPERATION: "promote",
      EXPECTED_ALIAS_OPERATION_DEPLOYMENT_ID: "dpl_expected",
      VERCEL_TOKEN: "fictional-token",
      VERCEL_TEAM_ID: "team_expected",
      VERCEL_ROOT_PROJECT_ID: "prj_expected",
      VERCEL_ALIAS_OPERATION_TIMEOUT_SECONDS: "5",
      VERCEL_ALIAS_VERIFY_TIMEOUT_SECONDS: verificationTimeout,
      PRODUCTION_DEPLOYMENT_ID: "dpl_expected",
      REQUEST_LOG: join(dir, "requests"),
      FAKE_ALIASES: JSON.stringify(aliases),
      FAKE_READY: ready,
      FAKE_PROJECT: project,
      FAKE_OPERATIONS: JSON.stringify(operations),
      FAKE_DEPLOYMENT_ALIASES: JSON.stringify(deploymentAliases),
    };
    try {
      await run(
        "/bin/bash",
        [direct ? verifier.replace("-operation.sh", ".sh") : verifier],
        { env, timeout: 15_000 },
      );
      return { success: true, requests: readFileSync(env.REQUEST_LOG, "utf8") };
    } catch (error) {
      assert.equal(
        error.killed,
        false,
        "verifier must stop through its own bounded checks",
      );
      return {
        success: false,
        requests: readFileSync(env.REQUEST_LOG, "utf8"),
      };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test(
  "missing operation requires two exact READY alias observations",
  { timeout: 30_000 },
  async () => {
    const result = await verify();
    assert.equal(result.success, true);
    assert.equal(result.requests.split("/v9/projects/").length - 1, 4);
    assert.equal(result.requests.split("/v4/aliases").length - 1, 4);
    assert.equal(result.requests.split("/v13/deployments/").length - 1, 2);
  },
);

test(
  "domain assignment stays authoritative when deployment aliases omit it",
  { timeout: 30_000 },
  async () => {
    const result = await verify({ deploymentAliases: ["fixture.vercel.app"] });
    assert.equal(result.success, true);
    assert.equal(result.requests.split("/v4/aliases").length - 1, 4);
  },
);

test(
  "missing operation never accepts a different alias or unfinished deployment",
  { timeout: 30_000 },
  async () => {
    for (const overrides of [{ alias: "dpl_other" }, { ready: "BUILDING" }]) {
      assert.equal((await verify(overrides)).success, false);
    }
  },
);

test("project mismatch cannot use the absent-operation fallback", async () => {
  const result = await verify({ project: "prj_other" });
  assert.equal(result.success, false);
  assert.ok(!result.requests.includes("/v4/aliases"));
});

test("direct verifier refuses a domain moved during deployment validation", async () => {
  const result = await verify({
    direct: true,
    aliases: ["dpl_expected", "dpl_other"],
  });
  assert.equal(result.success, false);
});

test(
  "direct verifier retries inconclusive final domain reads",
  { timeout: 30_000 },
  async () => {
    for (const failure of ["network_error", "malformed"]) {
      const result = await verify({
        direct: true,
        verificationTimeout: "10",
        aliases: ["dpl_expected", failure, "dpl_expected"],
      });
      assert.equal(result.success, true);
      assert.equal(result.requests.split("/v4/aliases").length - 1, 4);
    }
  },
);

test(
  "a new pending operation interrupts absent-operation confirmation",
  { timeout: 30_000 },
  async () => {
    const result = await verify({
      operations: [
        null,
        {
          type: "promote",
          toDeploymentId: "dpl_expected",
          jobStatus: "pending",
        },
      ],
    });
    assert.equal(result.success, false);
    assert.equal(result.requests.split("/v4/aliases").length - 1, 2);
  },
);

test(
  "a promotion starting during the second alias read prevents settlement",
  { timeout: 30_000 },
  async () => {
    const result = await verify({
      operations: [
        null,
        null,
        null,
        {
          type: "promote",
          toDeploymentId: "dpl_other",
          jobStatus: "pending",
        },
      ],
    });
    assert.equal(result.success, false);
    assert.equal(result.requests.split("/v4/aliases").length - 1, 4);
  },
);

test("matching terminal operation retains the existing behavior", async () => {
  const result = await verify({
    operations: [
      {
        type: "promote",
        toDeploymentId: "dpl_expected",
        jobStatus: "succeeded",
      },
    ],
  });
  assert.equal(result.success, true);
  assert.ok(!result.requests.includes("/v4/aliases"));
});
