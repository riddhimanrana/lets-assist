import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { NextRequest, NextResponse } from "next/server";
mock.module("server-only", () => ({}));
let observations = 0;
let runs = 0;
let fails = false;
let probe: NextResponse | null = null;
mock.module("@/lib/cron/auth-shape-probe", () => ({
  cronAuthShapeProbe: () => probe,
}));
mock.module("@/lib/cron/worker-observation", () => ({
  observeWorkerRun: async (name: string, run: () => Promise<Response>) => {
    expect(name).toBe("public-image-cleanup");
    observations++;
    return run();
  },
}));
mock.module("@/lib/storage/public-image-cleanup", () => ({
  runPublicImageCleanup: async () => {
    runs++;
    if (fails) throw new Error("private-storage-path-and-token");
    return { claimed: 4, deleted: 1, retained: 1, retryable: 1, failed: 1 };
  },
}));
const { GET, POST } = await import("./route");
const keys = [
  "CRON_TOKEN",
  "CRON_SECRET",
  "PUBLIC_IMAGE_CLEANUP_ENABLED",
] as const;
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
afterAll(() => {
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  mock.restore();
});
beforeEach(() => {
  keys.forEach((key) => delete process.env[key]);
  process.env.CRON_TOKEN = "fictional-image-cron";
  observations = 0;
  runs = 0;
  fails = false;
  probe = null;
});
const request = (header = "Bearer fictional-image-cron") =>
  new NextRequest("http://127.0.0.1/api/cron/public-image-cleanup", {
    headers: { authorization: header },
  });
test("auth, local probe and disabled requests never observe or dispatch cleanup", async () => {
  for (const header of [
    "Bearer wrong",
    "fictional-image-cron",
    "Bearer fictional-image-cron extra",
  ])
    expect((await POST(request(header))).status).toBe(401);
  probe = NextResponse.json({ dispatched: false });
  expect(await GET(request())).toBe(probe);
  probe = null;
  expect(await (await POST(request())).json()).toEqual({ enabled: false });
  process.env.PUBLIC_IMAGE_CLEANUP_ENABLED = "TRUE";
  expect(await (await POST(request())).json()).toEqual({ enabled: false });
  delete process.env.CRON_TOKEN;
  expect((await POST(request())).status).toBe(401);
  expect(observations).toBe(0);
  expect(runs).toBe(0);
});
test("enabled cleanup records one bounded aggregate pass", async () => {
  process.env.PUBLIC_IMAGE_CLEANUP_ENABLED = "true";
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    enabled: true,
    claimed: 4,
    deleted: 1,
    retained: 1,
    retryable: 1,
    failed: 1,
  });
  expect(observations).toBe(1);
  expect(runs).toBe(1);
});
test("failure responses never expose Storage paths or upstream errors", async () => {
  process.env.PUBLIC_IMAGE_CLEANUP_ENABLED = "true";
  fails = true;
  const response = await GET(request());
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("private-storage-path-and-token");
  expect(observations).toBe(1);
  expect(runs).toBe(1);
});

test("Vercel and legacy cron credentials both work when independently configured", async () => {
  process.env.CRON_SECRET = "fictional-vercel-cron";
  expect((await POST(request("Bearer fictional-vercel-cron"))).status).toBe(
    200,
  );
  expect((await GET(request())).status).toBe(200);
  expect((await GET(request("fictional-vercel-cron"))).status).toBe(401);
  process.env.CRON_TOKEN = "";
  expect((await POST(request("Bearer fictional-vercel-cron"))).status).toBe(
    200,
  );
  expect(observations).toBe(0);
  expect(runs).toBe(0);
});
