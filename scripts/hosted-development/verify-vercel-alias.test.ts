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

function runVerifier(
  overrides: {
    criticalState?: string;
    environment?: string;
    version?: string;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "csf-vercel-runtime-"));
  temporaryDirectories.push(directory);
  const requestLog = join(directory, "requests.log");
  const fakeCurl = join(directory, "curl");
  const criticalState = overrides.criticalState ?? "pass";
  const environment = overrides.environment ?? "preview";
  const version =
    overrides.version ?? "1111111111111111111111111111111111111111";
  writeFileSync(requestLog, "");

  writeFileSync(
    fakeCurl,
    `#!/usr/bin/env bash
set -euo pipefail
url=""
for argument in "$@"; do
  printf '%s\\n' "$argument" >> "${requestLog}"
  if [[ "$argument" == https://* ]]; then
    url="$argument"
  fi
done
case "$url" in
  "https://dev.lets-assist.com/api/status"*)
    printf '%s\\n' '{"service":"lets-assist","status":"operational","environment":"${environment}","version":"${version}","checks":[{"name":"environment","state":"${criticalState}","critical":true}]}'
    ;;
  *)
    printf 'Unexpected endpoint: %s\\n' "$url" >&2
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
      PATH: `${directory}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      VERCEL_AUTOMATION_BYPASS_SECRET: "test_bypass_secret",
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

describe("hosted Development runtime verifier", () => {
  test("accepts the exact healthy Preview SHA on the Development hostname", () => {
    const result = runVerifier();

    expect(result.exitCode).toBe(0);
    expect(result.requests).toContain("https://dev.lets-assist.com/api/status");
    expect(result.requests).toContain("x-vercel-protection-bypass");
    expect(result.requests).not.toContain("https://api.vercel.com");
    expect(result.requests).not.toContain("--location");
  });

  test("rejects a Production response on the Development hostname", () => {
    const result = runVerifier({ environment: "production" });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "The Development domain is not serving the exact accepted Preview deployment.",
    );
  });

  test("rejects deployment metadata for another commit", () => {
    const result = runVerifier({
      version: "2222222222222222222222222222222222222222",
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "The Development domain is not serving the exact accepted Preview deployment.",
    );
  });

  test("rejects a failed critical runtime check", () => {
    const result = runVerifier({ criticalState: "fail" });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "The Development domain is not serving the exact accepted Preview deployment.",
    );
  });
});
