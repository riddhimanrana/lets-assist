#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import fg from "fast-glob";

const preload = [
  "--preload",
  "./scripts/local-dev/server-only-test-preload.ts",
];
const groups = [
  {
    name: "authentication and deployment safety",
    args: [
      "test",
      "app/api/calendar/google/callback/connection-selection.test.ts",
      "lib/auth/google-oauth-connection-store.test.ts",
      "lib/auth/google-oauth-state.test.ts",
      "lib/auth/google-oauth-authorization.test.ts",
      "scripts/check-source-data-hygiene.test.ts",
      "scripts/check-source-organization.test.ts",
      "scripts/check-supabase-seed-safety.test.ts",
      "scripts/private-submodule-ci-credential.test.ts",
      "scripts/local-dev/dv-local-env-app.test.ts",
      "scripts/local-dev/dv-local-env.test.ts",
      "scripts/local-dev/supabase-cli-version.test.ts",
      "scripts/verify-supabase-migration-parity.test.ts",
      "scripts/verify-deployment-environment.test.ts",
      "scripts/verify-production-schema-deployment.test.ts",
    ],
  },
  {
    name: "root acquisition and harness safety",
    args: [
      "test",
      ...preload,
      "components/projects/project-feed-lifecycle.test.ts",
      "lib/auth/theme-script-boundary.test.ts",
      "lib/ai/dependency-boundaries.test.ts",
      "lib/supabase/retry-query.test.ts",
      "lib/supabase/retry-policy-boundary.test.ts",
      "scripts/local-dev/csf-browser-harness.launcher-ownership.test.ts",
      "scripts/local-dev/csf-browser-harness.docker-lifecycle.test.ts",
      "scripts/local-dev/csf-browser-harness.verifier-workflow.test.ts",
      "scripts/local-dev/csf-browser-harness.ci-contracts.test.ts",
      "services/google-drive-metadata.test.ts",
      "services/google-sheets-report-safety.test.ts",
      "services/google-sheets-source-snapshot.test.ts",
    ],
  },
  {
    name: "seed execution plans",
    args: ["test", "scripts/local-dev/seed-platform.test.ts"],
  },
  {
    name: "cron auth and shape",
    args: [
      "test",
      ...preload,
      "scripts/local-dev/cron-auth-shape-probe.test.ts",
    ],
  },
  {
    name: "cron harness",
    args: ["test", "scripts/local-dev/test-cron-endpoints.test.ts"],
  },
  {
    name: "isolated app runner",
    args: ["test", "scripts/local-dev/run-dvhs-csf-isolated-app.test.ts"],
  },
];

const testFilePatterns = [
  "**/*.test.{ts,tsx,js,mjs,cjs}",
  "**/*.spec.{ts,tsx,js,mjs,cjs}",
];
const discoveryIgnore = [
  ".artifacts/**",
  ".next/**",
  "lib/plugins/**",
  "node_modules/**",
  "tests/e2e/**",
];

function filesNamedByGroup(group) {
  return group.args.filter((arg) =>
    /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(arg),
  );
}

const explicitlyGroupedFiles = new Set(groups.flatMap(filesNamedByGroup));
const discoveredRootFiles = await fg(testFilePatterns, {
  cwd: process.cwd(),
  ignore: discoveryIgnore,
  onlyFiles: true,
  unique: true,
});
const remainingRootFiles = discoveredRootFiles
  .filter((file) => !explicitlyGroupedFiles.has(file))
  .sort();
const isolatedMockFiles = remainingRootFiles.filter((file) =>
  /\bmock\.module\s*\(/u.test(readFileSync(file, "utf8")),
);
const ordinaryRootFiles = remainingRootFiles.filter(
  (file) => !isolatedMockFiles.includes(file),
);

function run(name, command, args) {
  console.log(`\n[test] ${name}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const group of groups) run(group.name, "bun", group.args);

if (ordinaryRootFiles.length > 0) {
  run("remaining root unit tests", "bun", [
    "test",
    ...preload,
    ...ordinaryRootFiles,
  ]);
}

for (const file of isolatedMockFiles) {
  run(`mock-isolated root test: ${file}`, "bun", ["test", ...preload, file]);
}

if (!process.argv.includes("--root-only")) {
  run("plugin unit and security", "bun", ["test", ...preload, "lib/plugins"]);
}

console.log(
  `\n[test] PASS: ${discoveredRootFiles.length} root test files were discovered; every mock-sensitive file ran in its own Bun process.`,
);
