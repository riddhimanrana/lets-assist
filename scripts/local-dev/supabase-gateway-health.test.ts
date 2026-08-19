import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureGatewayHealthy,
  parseLocalGatewayStatus,
  parseTopLevelProjectId,
  selectGatewayContainer,
} from "./supabase-gateway-health-core.mjs";

const CONTAINER_ID = "a".repeat(64);

function status(apiUrl = "http://127.0.0.1:54321") {
  return JSON.stringify({ API_URL: apiUrl, ANON_KEY: "x".repeat(32) });
}

function inspectFixture({
  id = CONTAINER_ID,
  projectId = "lets-assist",
  hostPort = "54321",
  running = true,
  name = "supabase_kong_lets-assist",
} = {}) {
  return {
    Id: id,
    Name: name,
    State: { Running: running },
    Config: { Labels: { "com.supabase.cli.project": projectId } },
    NetworkSettings: {
      Ports: { "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: hostPort }] },
    },
  };
}

test("status parsing accepts only an explicit bounded loopback API", () => {
  const parsed = parseLocalGatewayStatus(status());
  assert.equal(parsed.apiUrl.href, "http://127.0.0.1:54321/");
  assert.equal(parsed.port, 54321);

  for (const url of [
    "https://example.supabase.co",
    "http://0.0.0.0:54321",
    "http://127.0.0.1",
    "http://127.0.0.1:54321/rest/v1",
  ]) {
    assert.throws(() => parseLocalGatewayStatus(status(url)), /loopback|port/u);
  }
});

test("top-level project parsing ignores hosted override sections", () => {
  assert.equal(
    parseTopLevelProjectId(
      'project_id = "lets-assist"\n[remotes.development]\nproject_id = "hosted-ref"\n',
    ),
    "lets-assist",
  );
  assert.throws(
    () =>
      parseTopLevelProjectId(
        '[remotes.development]\nproject_id = "hosted-ref"\n',
      ),
    /exactly one/u,
  );
});

test("gateway selection uses exact label and host port, never a service name", () => {
  const envoyNamed = inspectFixture({ name: "future_envoy_gateway" });
  const unrelated = inspectFixture({
    id: "b".repeat(64),
    hostPort: "54323",
    name: "supabase_studio_lets-assist",
  });
  assert.equal(
    selectGatewayContainer(
      JSON.stringify([envoyNamed, unrelated]),
      "lets-assist",
      54321,
    ),
    CONTAINER_ID,
  );
});

test("gateway selection refuses wrong labels, stopped rows, and ambiguity", () => {
  assert.throws(
    () =>
      selectGatewayContainer(
        JSON.stringify([inspectFixture({ projectId: "other" })]),
        "lets-assist",
        54321,
      ),
    /found 0/u,
  );
  assert.throws(
    () =>
      selectGatewayContainer(
        JSON.stringify([inspectFixture({ running: false })]),
        "lets-assist",
        54321,
      ),
    /found 0/u,
  );
  assert.throws(
    () =>
      selectGatewayContainer(
        JSON.stringify([
          inspectFixture(),
          inspectFixture({ id: "b".repeat(64), name: "second-gateway" }),
        ]),
        "lets-assist",
        54321,
      ),
    /found 2/u,
  );
});

test("a healthy gateway performs no Docker mutation", async () => {
  let dockerCalls = 0;
  const result = await ensureGatewayHealthy({
    probe: async () => true,
    sleep: async () => {},
    listContainerIds: async () => {
      dockerCalls += 1;
      return [];
    },
    inspectContainers: async () => "[]",
    restartContainer: async () => {
      dockerCalls += 1;
    },
    selectContainer: () => CONTAINER_ID,
  });

  assert.deepEqual(result, {
    healthy: true,
    restarted: false,
    containerId: null,
  });
  assert.equal(dockerCalls, 0);
});

test("an unhealthy gateway restarts one selected container and proves recovery", async () => {
  let probes = 0;
  const restarted: string[] = [];
  const result = await ensureGatewayHealthy({
    probe: async () => {
      probes += 1;
      return probes >= 3;
    },
    sleep: async () => {},
    listContainerIds: async () => [CONTAINER_ID.slice(0, 12)],
    inspectContainers: async () => JSON.stringify([inspectFixture()]),
    restartContainer: async (id: string) => restarted.push(id),
    selectContainer: (output: string) =>
      selectGatewayContainer(output, "lets-assist", 54321),
    initialAttempts: 2,
    recoveryAttempts: 2,
    delayMs: 0,
  });

  assert.equal(result.restarted, true);
  assert.deepEqual(restarted, [CONTAINER_ID]);
});

test("failed recovery is fatal instead of silently ignored", async () => {
  await assert.rejects(
    ensureGatewayHealthy({
      probe: async () => false,
      sleep: async () => {},
      listContainerIds: async () => [CONTAINER_ID],
      inspectContainers: async () => JSON.stringify([inspectFixture()]),
      restartContainer: async () => {},
      selectContainer: (output: string) =>
        selectGatewayContainer(output, "lets-assist", 54321),
      initialAttempts: 1,
      recoveryAttempts: 1,
      delayMs: 0,
    }),
    /remained unhealthy/u,
  );
});
