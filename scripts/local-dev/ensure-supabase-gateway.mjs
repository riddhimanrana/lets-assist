import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import {
  ensureGatewayHealthy,
  parseLocalGatewayStatus,
  parseTopLevelProjectId,
  selectGatewayContainer,
} from "./supabase-gateway-health-core.mjs";

const REQUIRED_CLI_VERSION = "2.111.0";
const repositoryRoot = new URL("../../", import.meta.url);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args[0] ?? ""} failed.`);
  }
  return result.stdout;
}

const cliVersion = run("supabase", ["--version"]).trim();
if (cliVersion !== REQUIRED_CLI_VERSION) {
  throw new Error(
    `Supabase CLI ${REQUIRED_CLI_VERSION} is required; found ${cliVersion || "unknown"}.`,
  );
}

const status = parseLocalGatewayStatus(
  run("supabase", ["status", "-o", "json"]),
);
const projectId = parseTopLevelProjectId(
  await readFile(new URL("supabase/config.toml", repositoryRoot), "utf8"),
);

async function probe() {
  const response = await fetch(new URL("/rest/v1/", status.apiUrl), {
    method: "GET",
    headers: {
      accept: "application/openapi+json",
      apikey: status.anonKey,
      authorization: `Bearer ${status.anonKey}`,
    },
    signal: AbortSignal.timeout(2_000),
  });
  await response.body?.cancel();
  return response.status === 200;
}

const result = await ensureGatewayHealthy({
  probe,
  sleep: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  listContainerIds: async () =>
    run("docker", [
      "ps",
      "--filter",
      `label=com.supabase.cli.project=${projectId}`,
      "--format",
      "{{.ID}}",
    ])
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .filter(Boolean),
  inspectContainers: async (containerIds) =>
    run("docker", ["inspect", ...containerIds]),
  restartContainer: async (containerId) => {
    run("docker", ["restart", containerId]);
  },
  selectContainer: (inspectOutput) =>
    selectGatewayContainer(inspectOutput, projectId, status.port),
});

if (result.restarted) {
  console.log(
    `Local Supabase REST gateway recovered after one exact-container restart (${result.containerId.slice(0, 12)}).`,
  );
} else {
  console.log(
    `Local Supabase REST gateway is healthy on loopback port ${status.port}.`,
  );
}
