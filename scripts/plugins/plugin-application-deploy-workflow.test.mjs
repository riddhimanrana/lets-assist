import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const workflow = readFileSync(
  join(repositoryRoot, ".github/workflows/plugin-application-deploy.yml"),
  "utf8",
);

test("deployment workflow keeps Development and Production separated", () => {
  assert.match(workflow, /environment: \$\{\{ inputs\.environment \}\}/u);
  assert.match(workflow, /expected_branch=development/u);
  assert.match(workflow, /expected_branch=main/u);
  assert.match(workflow, /- production/u);
});

test("deployment workflow verifies immutable release identity before deploy", () => {
  assert.match(workflow, /release\.cdx\.json/u);
  assert.match(workflow, /cosign verify-blob/u);
  assert.match(workflow, /sha256sum --check/u);
  assert.match(workflow, /verify-application-deployment\.mjs/u);
  assert.match(workflow, /validate-application-archive\.mjs/u);
  assert.match(workflow, /vercel@59\.3\.0/u);
  assert.match(workflow, /--prebuilt/u);
});

test("deployment workflow pins the Vercel target and accepts current CLI JSON", () => {
  assert.match(workflow, /args\+=\(--target=preview\)/u);
  assert.match(workflow, /args\+=\(--prod\)/u);
  assert.match(workflow, /\.deployment\.url \/\/ \.url/u);
  assert.match(workflow, /\.deployment\.id \/\/ \.id/u);
  assert.match(workflow, /\.deployment\.target \/\/ \.target/u);
  assert.match(workflow, /deployment_target/u);
});

test("deployment workflow records health through service-only RPCs", () => {
  assert.match(workflow, /secrets\.SUPABASE_SERVICE_ROLE_KEY/u);
  assert.match(workflow, /rpc\/observe_plugin_deployment/u);
  assert.match(workflow, /vercel@59\.3\.0 curl \/api\/health/u);
  assert.match(workflow, /rpc\/report_plugin_deployment_health/u);
  assert.match(workflow, /p_health_status:"unhealthy"/u);
  assert.doesNotMatch(workflow, /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/u);
});
