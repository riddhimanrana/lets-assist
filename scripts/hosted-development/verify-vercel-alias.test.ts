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

const verifierPath = new URL("./verify-vercel-alias.sh", import.meta.url)
  .pathname;
const temporaryDirectories: string[] = [];

afterAll(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function runVerifier(overrides: { gitBranch?: string; sha?: string } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "csf-vercel-domain-"));
  temporaryDirectories.push(directory);
  const requestLog = join(directory, "requests.log");
  const fakeCurl = join(directory, "curl");
  const gitBranch = overrides.gitBranch ?? "development";
  const sha = overrides.sha ?? "1111111111111111111111111111111111111111";

  writeFileSync(
    fakeCurl,
    `#!/usr/bin/env bash
set -euo pipefail
url=""
for argument in "$@"; do
  if [[ "$argument" == https://* ]]; then
    url="$argument"
  fi
done
printf '%s\\n' "$url" >> "${requestLog}"
case "$url" in
  *"/v9/projects/project_test/domains"*)
    printf '%s\\n' '{"domains":[{"name":"dev.lets-assist.com","projectId":"project_test","gitBranch":"${gitBranch}","verified":true,"redirect":null}]}'
    ;;
  *"/v7/deployments")
    printf '%s\\n' '{"deployments":[{"uid":"dpl_test","projectId":"project_test","readyState":"READY","target":null,"createdAt":1,"meta":{"githubCommitRepoId":"123","githubCommitSha":"1111111111111111111111111111111111111111","githubCommitRef":"development"}}]}'
    ;;
  *"/v13/deployments/dpl_test"*)
    printf '%s\\n' '{"id":"dpl_test","projectId":"project_test","readyState":"READY","target":null,"gitSource":{"type":"github","repoId":123,"sha":"${sha}","ref":"development"}}'
    ;;
  *)
    printf 'Unexpected Vercel endpoint: %s\\n' "$url" >&2
    exit 22
    ;;
esac
`,
  );
  chmodSync(fakeCurl, 0o755);

  const result = Bun.spawnSync(["/bin/bash", verifierPath], {
    env: {
      ...process.env,
      ACCEPTED_SHA: "1111111111111111111111111111111111111111",
      EXPECTED_GITHUB_REPOSITORY_ID: "123",
      PATH: `${directory}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      VERCEL_ROOT_PROJECT_ID: "project_test",
      VERCEL_TEAM_ID: "team_test",
      VERCEL_TOKEN: "test_token",
    },
    stderr: "pipe",
    stdout: "pipe",
  });

  return {
    exitCode: result.exitCode,
    requests: readFileSync(requestLog, "utf8"),
    stderr: result.stderr.toString(),
  };
}

describe("hosted Development Vercel domain verifier", () => {
  test("accepts a verified Development branch domain and exact ready SHA", () => {
    const result = runVerifier();

    expect(result.exitCode).toBe(0);
    expect(result.requests).toContain("/v9/projects/project_test/domains");
    expect(result.requests).toContain("/v7/deployments");
    expect(result.requests).toContain("/v13/deployments/dpl_test");
    expect(result.requests).not.toContain("/v4/aliases");
  });

  test("rejects a domain assigned to another branch", () => {
    const result = runVerifier({ gitBranch: "main" });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "The Development domain is not assigned to the Development branch.",
    );
    expect(result.requests).not.toContain("/v7/deployments");
  });

  test("rejects deployment metadata for another commit", () => {
    const result = runVerifier({
      sha: "2222222222222222222222222222222222222222",
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "The Development domain is not serving the exact accepted deployment.",
    );
  });
});
