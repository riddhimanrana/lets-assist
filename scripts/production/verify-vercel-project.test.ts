import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const verifierPath = new URL("./verify-vercel-project.sh", import.meta.url)
  .pathname;
const workflowPath = new URL(
  "../../.github/workflows/diagnose-production-vercel-project.yml",
  import.meta.url,
).pathname;
const temporaryDirectories: string[] = [];

afterAll(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
});

type Endpoint = "project" | "rolling-release-config" | "rolling-release-state";

function runVerifier(
  overrides: {
    failure?: Endpoint;
    failureCode?: string;
    malformed?: Endpoint;
    networkError?: Endpoint;
    projectPayload?: string;
    rollingConfigPayload?: string;
    rollingStatePayload?: string;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "csf-vercel-project-"));
  temporaryDirectories.push(directory);
  const fakeCurl = join(directory, "curl");
  const secret = "fictional-token-never-print";

  writeFileSync(
    fakeCurl,
    `#!/usr/bin/env bash
set -euo pipefail
output=""
url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    --write-out) shift 2 ;;
    https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
if [[ "$url" == *'/rolling-release/config?'* ]]; then
  endpoint='rolling-release-config'
  payload='${overrides.rollingConfigPayload ?? '{"rollingRelease":null}'}'
elif [[ "$url" == *'/rolling-release?'* ]]; then
  endpoint='rolling-release-state'
  payload='${overrides.rollingStatePayload ?? '{"rollingRelease":null}'}'
else
  endpoint='project'
  payload='${overrides.projectPayload ?? '{"id":"project_expected","accountId":"team_expected","link":{"type":"github","repoId":12345,"productionBranch":"main"},"autoExposeSystemEnvs":true}'}'
fi
if [[ "$endpoint" == '${overrides.networkError ?? "none"}' ]]; then
  exit 7
fi
if [[ "$endpoint" == '${overrides.malformed ?? "none"}' ]]; then
  printf '{' >"$output"
  printf '200'
elif [[ "$endpoint" == '${overrides.failure ?? "none"}' ]]; then
  printf '%s' '{"error":{"code":"${overrides.failureCode ?? "forbidden"}","message":"provider detail ${secret}"},"token":"${secret}"}' >"$output"
  printf '403'
else
  printf '%s' "$payload" >"$output"
  printf '200'
fi
`,
  );
  chmodSync(fakeCurl, 0o755);

  const result = Bun.spawnSync(["/bin/bash", verifierPath], {
    env: {
      ...process.env,
      EXPECTED_GITHUB_REPOSITORY_ID: "12345",
      PATH: `${directory}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      VERCEL_ROOT_PROJECT_ID: "project_expected",
      VERCEL_TEAM_ID: "team_expected",
      VERCEL_TOKEN: secret,
    },
    stderr: "pipe",
    stdout: "pipe",
  });

  return {
    exitCode: result.exitCode,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
    secret,
  };
}

describe("Production Vercel project verifier", () => {
  test("accepts the expected binding with no active rolling release", () => {
    const result = runVerifier();
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("endpoint=project status=200");
    expect(result.output).toContain(
      "endpoint=rolling-release-config status=200",
    );
    expect(result.output).toContain(
      "endpoint=rolling-release-state status=200",
    );
  });

  for (const endpoint of [
    "project",
    "rolling-release-config",
    "rolling-release-state",
  ] as const) {
    test(`labels and redacts a ${endpoint} provider failure`, () => {
      const result = runVerifier({ failure: endpoint });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain(
        `endpoint=${endpoint} status=403 error.code=forbidden`,
      );
      expect(result.output).not.toContain(result.secret);
      expect(result.output).not.toContain("provider detail");
    });
  }

  test("maps an unknown token-shaped provider code to unrecognized", () => {
    const unknownCode = `token_${"a".repeat(48)}`;
    const result = runVerifier({
      failure: "project",
      failureCode: unknownCode,
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain(
      "endpoint=project status=403 error.code=unrecognized",
    );
    expect(result.output).not.toContain(unknownCode);
  });

  test("rejects a project bound to another repository", () => {
    const result = runVerifier({
      projectPayload:
        '{"id":"project_expected","accountId":"team_expected","link":{"type":"github","repoId":99999,"productionBranch":"main"},"autoExposeSystemEnvs":true}',
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("GitHub binding");
  });

  test("rejects enabled rolling releases and an active rolling release", () => {
    const configured = runVerifier({
      rollingConfigPayload: '{"rollingRelease":{"enabled":true}}',
    });
    const active = runVerifier({
      rollingStatePayload: '{"rollingRelease":{"state":"IN_PROGRESS"}}',
    });
    expect(configured.exitCode).not.toBe(0);
    expect(configured.output).toContain("Rolling Releases must be disabled");
    expect(active.exitCode).not.toBe(0);
    expect(active.output).toContain("active Vercel Rolling Release");
  });

  test("requires explicit rolling release fields on object responses", () => {
    for (const rollingConfigPayload of ["{}", "[]"]) {
      const result = runVerifier({ rollingConfigPayload });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Rolling Releases must be disabled");
    }

    for (const rollingStatePayload of ["{}", "[]"]) {
      const result = runVerifier({ rollingStatePayload });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("active Vercel Rolling Release");
    }
  });

  test("fails closed on malformed success payloads and network errors", () => {
    for (const endpoint of [
      "project",
      "rolling-release-config",
      "rolling-release-state",
    ] as const) {
      const malformed = runVerifier({ malformed: endpoint });
      expect(malformed.exitCode).not.toBe(0);
      expect(malformed.output).toContain(
        `endpoint=${endpoint} response=malformed-json`,
      );

      const networkError = runVerifier({ networkError: endpoint });
      expect(networkError.exitCode).not.toBe(0);
      expect(networkError.output).toContain(
        `endpoint=${endpoint} status=network-error`,
      );
    }
  });

  test("manual diagnostic workflow is read only and reuses Production credentials", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
    expect(workflow).not.toContain("refs/heads/development");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("secrets.VERCEL_TOKEN");
    expect(workflow).toContain("scripts/production/verify-vercel-project.sh");
    expect(workflow).not.toMatch(
      /vercel deploy|vercel promote|curl .*-X|--request|supabase/u,
    );
  });
});
