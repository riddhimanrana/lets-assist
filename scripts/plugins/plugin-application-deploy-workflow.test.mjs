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
  assert.doesNotMatch(workflow, /--scope=/u);
  assert.match(workflow, /\.buildArtifact\.artifacts\.development\.name/u);
  assert.match(workflow, /\.buildArtifact\.artifacts\.production\.name/u);
  assert.match(workflow, /plugin-build-\$\{DEPLOYMENT_ENVIRONMENT\}\.tar\.gz/u);
  assert.match(workflow, /--environment "\$\{DEPLOYMENT_ENVIRONMENT\}"/u);
});

test("deployment workflow separates Vercel Preview and Production targets", () => {
  assert.doesNotMatch(workflow, /--target=development/u);
  assert.match(workflow, /args\+=\(--prod\)/u);
  assert.match(workflow, /\.deployment\.url \/\/ \.url/u);
  assert.match(workflow, /\.deployment\.id \/\/ \.id/u);
  assert.match(workflow, /\.deployment\.target \/\/ \.target/u);
  assert.match(workflow, /deployment_target.*== preview/u);
  assert.match(workflow, /deployment_target.*== null/u);
  assert.match(workflow, /deployment_target.*== production/u);
});

test("deployment workflow records health through service-only RPCs", () => {
  const healthStep = workflow.match(
    /- name: Verify application health[\s\S]*?(?=\n {6}- name:)/u,
  )?.[0];
  assert.ok(healthStep);
  assert.match(workflow, /secrets\.SUPABASE_SERVICE_ROLE_KEY/u);
  assert.match(workflow, /secrets\.VERCEL_AUTOMATION_BYPASS_SECRET/u);
  assert.match(workflow, /rpc\/observe_plugin_deployment/u);
  assert.match(
    healthStep,
    /x-vercel-protection-bypass: \$\{VERCEL_AUTOMATION_BYPASS_SECRET\}[\s\S]*\/api\/plugins\/\$\{PLUGIN_KEY\}\/health/u,
  );
  assert.doesNotMatch(healthStep, /--token="\$\{VERCEL_TOKEN\}"/u);
  assert.match(healthStep, /response_reached=true/u);
  assert.match(healthStep, /--write-out '%\{http_code\}'/u);
  assert.match(healthStep, /\^2\[0-9\]\[0-9\]\$/u);
  assert.doesNotMatch(healthStep, /--fail-with-body/u);
  assert.match(workflow, /recorded state remains pending/u);
  assert.match(workflow, /steps\.health\.outputs\.response_reached == 'true'/u);
  assert.match(workflow, /rpc\/report_plugin_deployment_health/u);
  assert.match(workflow, /p_health_status:"unhealthy"/u);
  assert.doesNotMatch(workflow, /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/u);
});
