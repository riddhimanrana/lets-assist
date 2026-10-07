import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
let executions = 0;
let observations = 0;
mock.module("@/services/recurring-project-worker", () => ({
  processRecurringProjects: async () => {
    executions++;
    return { processedProjects: 0, createdOccurrences: 0, errors: [] };
  },
}));
mock.module("@/lib/cron/worker-observation", () => ({
  observeWorkerRun: async (
    worker: string,
    operation: () => Promise<Response>,
  ) => {
    expect(worker).toBe("generate-recurring-projects");
    observations++;
    return operation();
  },
}));
const { GET, POST } = await import("./route");
const keys = [
  "CRON_TOKEN",
  "CRON_SECRET",
  "RECURRING_PROJECTS_SECRET_TOKEN",
] as const;
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
afterAll(() => {
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});
beforeEach(() => {
  keys.forEach((key) => delete process.env[key]);
  process.env.CRON_TOKEN = "fictional-recurring-cron";
  executions = 0;
  observations = 0;
});
function request(authorization: string, status = false) {
  return new NextRequest(
    `http://127.0.0.1/api/cron/generate-recurring-projects${status ? "?status=1" : ""}`,
    { headers: { authorization } },
  );
}
test("malformed bearer credentials cannot invoke recurring work or read status", async () => {
  for (const authorization of [
    "fictional-recurring-cron",
    "bearer fictional-recurring-cron",
    "Bearer  fictional-recurring-cron",
    "Bearer fictional-recurring-cron extra",
  ]) {
    expect((await POST(request(authorization))).status).toBe(401);
    expect((await GET(request(authorization, true))).status).toBe(401);
  }
  expect(executions).toBe(0);
  expect(observations).toBe(0);
});
test("exact bearer requests execute once, while an authenticated status read does no work", async () => {
  expect(
    (await GET(request("Bearer fictional-recurring-cron", true))).status,
  ).toBe(200);
  expect(observations).toBe(0);
  expect((await POST(request("Bearer fictional-recurring-cron"))).status).toBe(
    200,
  );
  expect(executions).toBe(1);
  expect(observations).toBe(1);
});
