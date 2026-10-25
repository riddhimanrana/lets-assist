import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, afterEach, test } from "node:test";
import {
  expectedVersions,
  productionRef,
  safeFailureMessage,
} from "../production/app-release-checks.mjs";
import { historicalReleaseTestFixture } from "../production/historical-release-test-fixture.mjs";
import { applicationDeploymentFixture } from "./application-deployment-fixture.mjs";
import { verifyApplicationDatabase } from "./verify-application-database.mjs";

const schema = historicalReleaseTestFixture();
after(schema.dispose);
const versions = expectedVersions(schema.cwd);
const fixtures = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.dispose();
});
const developmentRef = "abcdefghijklmnopqrst";

function fixture(environment = "development") {
  const artifact = applicationDeploymentFixture();
  fixtures.push(artifact);
  artifact.manifest.buildArtifact.artifacts.production.digest =
    artifact.manifest.buildArtifact.artifacts.development.digest;
  const save = () => {
    writeFileSync(artifact.manifestPath, JSON.stringify(artifact.manifest));
    writeFileSync(artifact.registryPath, JSON.stringify(artifact.registry));
  };
  save();
  const projectRef =
    environment === "production" ? productionRef : developmentRef;
  const config = {
    cwd: schema.cwd,
    deployment: {
      manifestPath: artifact.manifestPath,
      registryPath: artifact.registryPath,
      targetsPath: artifact.targetsPath,
      buildPath: artifact.buildPath,
      releaseTag: "dvhs-csf/v1.2.0",
      pluginKey: "dvhs-csf",
      environment,
    },
    env: {
      GITHUB_REF: `refs/heads/${environment === "production" ? "main" : "development"}`,
      CSF_DEVELOPMENT_SUPABASE_PROJECT_REF: developmentRef,
      SUPABASE_PROJECT_ID: projectRef,
      SUPABASE_URL: `https://${projectRef}.supabase.co`,
      SUPABASE_ACCESS_TOKEN: "fictional-management-token",
      SUPABASE_SERVICE_ROLE_KEY: "fictional-observation-key",
    },
  };
  const publication = {
    plugin_key: "dvhs-csf",
    version: "1.2.0",
    status: "published",
    runtime_profile: "application",
    commit_sha: artifact.manifest.sourceCommit,
    required_platform_schema_version:
      artifact.manifest.requiredPlatformSchemaVersion,
    build_digest: artifact.manifest.buildDigest,
  };
  const responses = [
    versions.map((version) => ({ version })),
    [{ csf_target_schema_verified: 1 }],
    ...(environment === "production"
      ? [[{ valid: true }], [{ valid: true }]]
      : []),
    [publication],
  ];
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    assert.ok(responses.length, "unexpected provider request");
    return Response.json(responses.shift());
  };
  return { artifact, save, config, publication, responses, requests, fetcher };
}

test("Development verifies its complete catalog and immutable publication before returning readiness", async () => {
  const input = fixture();
  const result = await verifyApplicationDatabase(input.config, input.fetcher);
  assert.deepEqual(result, {
    environment: "development",
    projectRef: developmentRef,
    pluginKey: "dvhs-csf",
    version: "1.2.0",
    requiredPlatformSchemaVersion: "20260911203901",
    migrations: versions.length,
    head: versions.at(-1),
    catalog: "verified",
    publication: "verified",
  });
  assert.equal(input.requests.length, 3);
  assert.equal(
    input.requests[0].url,
    `https://api.supabase.com/v1/projects/${developmentRef}/database/query/read-only`,
  );
  assert.equal(JSON.parse(input.requests[0].options.body).read_only, true);
  const catalog = JSON.parse(input.requests[1].options.body).query;
  assert.match(
    catalog,
    /^BEGIN READ ONLY;\nSET LOCAL search_path TO public, extensions;/u,
  );
  assert.match(catalog, /actual.digest IS DISTINCT FROM expected.digest/u);
  assert.match(catalog, /account_deletion_storage_reference_fence/u);
  assert.match(catalog, /;\nCOMMIT;$/u);
  const publication = new URL(input.requests[2].url);
  assert.equal(publication.origin, `https://${developmentRef}.supabase.co`);
  assert.equal(publication.pathname, "/rest/v1/plugin_versions");
  assert.equal(publication.searchParams.get("limit"), "2");
  assert.equal(input.requests[2].options.method, "GET");
  assert.equal(
    input.requests[2].options.headers.Authorization,
    "Bearer fictional-observation-key",
  );
  assert.ok(!JSON.stringify(result).includes("fictional"));
});

test("Production retains all existing schema, preference and write-posture checks", async () => {
  const input = fixture("production");
  input.config.env.SUPABASE_URL = "https://api.lets-assist.com/";
  const result = await verifyApplicationDatabase(input.config, input.fetcher);
  assert.equal(result.projectRef, productionRef);
  assert.equal(input.requests.length, 5);
  assert.match(
    JSON.parse(input.requests[2].options.body).query,
    /set_csf_staff_view_mode/u,
  );
  assert.match(
    JSON.parse(input.requests[3].options.body).query,
    /default_transaction_read_only/u,
  );
  assert.match(
    input.requests[4].url,
    /^https:\/\/api\.lets-assist\.com\/rest\/v1\/plugin_versions\?/u,
  );
});

test("wrong lane, database origin, branch or missing lane credential refuses before provider access", async () => {
  const changes = [
    { GITHUB_REF: "refs/heads/main" },
    { SUPABASE_PROJECT_ID: productionRef },
    {
      CSF_DEVELOPMENT_SUPABASE_PROJECT_REF: productionRef,
      SUPABASE_PROJECT_ID: productionRef,
    },
    { SUPABASE_URL: `https://${productionRef}.supabase.co` },
    { SUPABASE_URL: "https://api.lets-assist.com" },
    { SUPABASE_URL: `http://${developmentRef}.supabase.co` },
    { SUPABASE_URL: `https://${developmentRef}.supabase.co?redirect=other` },
    { SUPABASE_URL: `https://credential@${developmentRef}.supabase.co` },
    { SUPABASE_URL: `https://${developmentRef}.supabase.co:8443` },
    { SUPABASE_ACCESS_TOKEN: "" },
    { SUPABASE_SERVICE_ROLE_KEY: "" },
  ];
  for (const change of changes) {
    const input = fixture();
    Object.assign(input.config.env, change);
    await assert.rejects(
      verifyApplicationDatabase(input.config, input.fetcher),
    );
    assert.equal(input.requests.length, 0);
  }
  const input = fixture("production");
  input.config.env.SUPABASE_ACCESS_TOKEN = "";
  await assert.rejects(
    verifyApplicationDatabase(input.config, input.fetcher),
    /no database-management credential/u,
  );
  assert.equal(input.requests.length, 0);
});

test("signed schema requirements must match publication and exist in the accepted host ledger", async () => {
  for (const mismatch of [true, false]) {
    const input = fixture();
    input.artifact.manifest.requiredPlatformSchemaVersion = "20990101000000";
    if (!mismatch)
      input.artifact.registry[0].requiredPlatformSchemaVersion =
        "20990101000000";
    input.save();
    await assert.rejects(
      verifyApplicationDatabase(input.config, input.fetcher),
      mismatch ? /registry does not match/u : /absent from the host ledger/u,
    );
    assert.equal(input.requests.length, 0);
  }
});

test("an unaccepted future host ledger refuses before provider access", async () => {
  const future = historicalReleaseTestFixture();
  try {
    writeFileSync(
      resolve(future.cwd, "supabase/migrations/20990101000000_unreviewed.sql"),
      "SELECT 1;\n",
    );
    const input = fixture();
    input.config.cwd = future.cwd;
    await assert.rejects(
      verifyApplicationDatabase(input.config, input.fetcher),
      /explicit release review/u,
    );
    assert.equal(input.requests.length, 0);
  } finally {
    future.dispose();
  }
});

test("missing, extra and reordered applied migration ledgers stop before catalog or publication reads", async () => {
  for (const ledger of [
    versions.slice(0, -1),
    [...versions, "20990101000000"],
    [...versions].reverse(),
  ]) {
    const input = fixture();
    input.responses[0] = ledger.map((version) => ({ version }));
    await assert.rejects(
      verifyApplicationDatabase(input.config, input.fetcher),
      /migration sequence/u,
    );
    assert.equal(input.requests.length, 1);
  }
});

test("schema drift and unresolved Production write posture refuse readiness", async () => {
  for (const environment of ["development", "production"]) {
    const input = fixture(environment);
    input.responses[1] = [{ csf_target_schema_verified: 0 }];
    await assert.rejects(
      verifyApplicationDatabase(input.config, input.fetcher),
      /catalog verification failed/u,
    );
    assert.equal(input.requests.length, 2);
  }
  const input = fixture("production");
  input.responses[3] = [{ valid: false }];
  await assert.rejects(
    verifyApplicationDatabase(input.config, input.fetcher),
    /write block/u,
  );
  assert.equal(input.requests.length, 4);
});

test("the target must expose exactly one matching signed release through the observation credential", async () => {
  for (const response of [
    [],
    [{ commit_sha: "b".repeat(40) }],
    [null],
    [{}, {}],
  ]) {
    const input = fixture();
    input.responses[2] = response;
    await assert.rejects(
      verifyApplicationDatabase(input.config, input.fetcher),
      /exact signed plugin publication/u,
    );
    assert.equal(input.requests.length, 3);
  }
});

test("provider denial and transport failures remain redacted and are never retried", async () => {
  for (const transportFailure of [false, true]) {
    const input = fixture();
    let requests = 0;
    let failure;
    try {
      await verifyApplicationDatabase(input.config, async () => {
        requests += 1;
        if (transportFailure) throw new Error("private-token=do-not-log");
        return new Response("private-token=do-not-log", { status: 403 });
      });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure);
    assert.equal(requests, 1);
    assert.doesNotMatch(
      safeFailureMessage(failure),
      /private-token|do-not-log/u,
    );
  }
});

test("a mismatched observation key refuses before any deployment can proceed", async () => {
  const input = fixture();
  let requests = 0;
  await assert.rejects(
    verifyApplicationDatabase(input.config, async (url, options) => {
      requests += 1;
      if (requests === 3)
        return new Response("secret provider detail", { status: 401 });
      return input.fetcher(url, options);
    }),
    /HTTP 401/u,
  );
  assert.equal(requests, 3);
});
