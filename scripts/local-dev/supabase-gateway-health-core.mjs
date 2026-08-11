const PROJECT_LABEL = "com.supabase.cli.project";

function assertRecord(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value;
}

export function parseLocalGatewayStatus(output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("Supabase status did not return valid JSON.");
  }

  const status = assertRecord(parsed, "Supabase status must be a JSON object.");
  if (
    typeof status.API_URL !== "string" ||
    typeof status.ANON_KEY !== "string"
  ) {
    throw new Error(
      "Supabase status omitted its local API URL or anonymous key.",
    );
  }

  let apiUrl;
  try {
    apiUrl = new URL(status.API_URL);
  } catch {
    throw new Error("Supabase status returned an invalid local API URL.");
  }

  if (
    apiUrl.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(apiUrl.hostname) ||
    apiUrl.username ||
    apiUrl.password ||
    apiUrl.pathname !== "/" ||
    apiUrl.search ||
    apiUrl.hash
  ) {
    throw new Error(
      "Refusing gateway health work outside an exact loopback HTTP API URL.",
    );
  }

  const port = Number(apiUrl.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(
      "The local Supabase API URL must include a bounded loopback port.",
    );
  }
  if (status.ANON_KEY.length < 20 || status.ANON_KEY.length > 4096) {
    throw new Error("Supabase status returned a malformed anonymous key.");
  }

  return { apiUrl, anonKey: status.ANON_KEY, port };
}

export function parseTopLevelProjectId(configText) {
  const topLevel = configText.split(/^\s*\[/mu, 1)[0];
  const matches = [
    ...topLevel.matchAll(/^\s*project_id\s*=\s*"([^"]+)"\s*$/gmu),
  ];
  if (matches.length !== 1) {
    throw new Error(
      "Supabase config must declare exactly one top-level project_id.",
    );
  }

  const projectId = matches[0][1];
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u.test(projectId)) {
    throw new Error("Supabase config has an invalid local project_id.");
  }
  return projectId;
}

export function selectGatewayContainer(inspectOutput, projectId, hostPort) {
  let parsed;
  try {
    parsed = JSON.parse(inspectOutput);
  } catch {
    throw new Error("Docker inspect did not return valid JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Docker inspect must return a container array.");
  }

  const candidates = parsed.filter((rawContainer) => {
    const container = assertRecord(
      rawContainer,
      "Docker returned an invalid container record.",
    );
    const labels = container.Config?.Labels;
    const ports = container.NetworkSettings?.Ports;
    return (
      typeof container.Id === "string" &&
      /^[0-9a-f]{64}$/u.test(container.Id) &&
      container.State?.Running === true &&
      labels?.[PROJECT_LABEL] === projectId &&
      ports &&
      Object.values(ports).some(
        (bindings) =>
          Array.isArray(bindings) &&
          bindings.some((binding) => binding?.HostPort === String(hostPort)),
      )
    );
  });

  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one running, project-labeled gateway on loopback port ${hostPort}; found ${candidates.length}.`,
    );
  }
  return candidates[0].Id;
}

async function waitForHealthyProbe(probe, sleep, attempts, delayMs) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (await probe()) return true;
    } catch {
      // Transport failures carry no additional safe diagnostic value here.
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  return false;
}

export async function ensureGatewayHealthy({
  probe,
  sleep,
  listContainerIds,
  inspectContainers,
  restartContainer,
  selectContainer,
  initialAttempts = 10,
  recoveryAttempts = 30,
  delayMs = 500,
}) {
  if (await waitForHealthyProbe(probe, sleep, initialAttempts, delayMs)) {
    return { healthy: true, restarted: false, containerId: null };
  }

  const containerIds = await listContainerIds();
  if (
    !Array.isArray(containerIds) ||
    containerIds.length < 1 ||
    containerIds.length > 64
  ) {
    throw new Error("Docker returned an invalid project-container inventory.");
  }
  if (containerIds.some((id) => !/^[0-9a-f]{12,64}$/u.test(id))) {
    throw new Error("Docker returned a malformed project container ID.");
  }

  const inspectOutput = await inspectContainers(containerIds);
  const containerId = selectContainer(inspectOutput);
  await restartContainer(containerId);

  if (!(await waitForHealthyProbe(probe, sleep, recoveryAttempts, delayMs))) {
    throw new Error(
      "The exact local gateway remained unhealthy after one bounded restart.",
    );
  }

  return { healthy: true, restarted: true, containerId };
}
