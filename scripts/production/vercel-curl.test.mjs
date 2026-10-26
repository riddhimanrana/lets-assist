import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";

const wrapper = new URL("./vercel-curl.sh", import.meta.url).pathname;
const secret = "fictional-bypass-token";
const args = (
  path = "/maintenance-health.txt",
  origin = "https://fixture.vercel.app",
) => [
  path,
  `--deployment=${origin}`,
  `--protection-bypass=${secret}`,
  "--yes",
  "--",
  "--connect-timeout",
  "1",
  "--max-time",
  "2",
];

async function fixture(t, handler) {
  const directory = mkdtempSync(join(tmpdir(), "production-https-test-"));
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({
      url: request.url,
      method: request.method,
      headers: request.headers,
    });
    handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  // Keep the real CLI parsing, URL validation, request, body and timeout code.
  // Redirect only the network socket to the local HTTP fixture.
  const preload = join(directory, "transport.cjs");
  writeFileSync(
    preload,
    `
    const https = require("node:https");
    const http = require("node:http");
    https.request = (target, options, callback) => {
      const local = new URL(target);
      local.protocol = "http:";
      local.hostname = "127.0.0.1";
      local.port = ${port};
      return http.request(local, options, callback);
    };
  `,
  );
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  });
  const run = (arguments_, extra = {}) =>
    new Promise((resolve) => {
      const process_ = spawn("bash", [wrapper, ...arguments_], {
        env: {
          PATH: process.env.PATH,
          NODE_OPTIONS: `--require=${preload}`,
          VERCEL_AUTOMATION_BYPASS_SECRET: secret,
          VERCEL_TOKEN: "fictional-vercel-token-must-not-be-forwarded",
          ...extra,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      process_.stdout.on("data", (data) => {
        stdout += data;
      });
      process_.stderr.on("data", (data) => {
        stderr += data;
      });
      process_.on("close", (status) => resolve({ status, stdout, stderr }));
    });
  return { run, requests };
}

test("the actual wrapper performs one authenticated GET without Vercel CLI passthrough", async (t) => {
  const f = await fixture(t, (_request, response) => {
    response.end("lets-assist-production-maintenance-v1");
  });
  const result = await f.run(args());
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "lets-assist-production-maintenance-v1");
  assert.equal(result.stderr, "");
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].method, "GET");
  assert.equal(f.requests[0].url, "/maintenance-health.txt");
  assert.equal(f.requests[0].headers["x-vercel-protection-bypass"], secret);
  assert.equal(f.requests[0].headers.authorization, undefined);
  assert.equal(f.requests[0].headers["cache-control"], "no-cache");
});

test("status query bytes and the successful response survive the helper", async (t) => {
  const f = await fixture(t, (_request, response) =>
    response.end('{"deep":true}'),
  );
  const result = await f.run(args("/api/status?deep=1"));
  assert.equal(result.status, 0);
  assert.equal(f.requests[0].url, "/api/status?deep=1");
  assert.deepEqual(JSON.parse(result.stdout), { deep: true });
});

for (const status of [302, 403, 503]) {
  test(`HTTP ${status} fails without retries, redirects or response disclosure`, async (t) => {
    const f = await fixture(t, (_request, response) => {
      response.writeHead(status, { location: "https://other.vercel.app/leak" });
      response.end(secret);
    });
    const result = await f.run(args());
    assert.notEqual(result.status, 0);
    assert.equal(f.requests.length, 1);
    assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, /fictional|other\.vercel/u);
  });
}

test("a stalled response is bounded and does not retry", async (t) => {
  const f = await fixture(t, () => {});
  const started = Date.now();
  const result = await f.run(args());
  assert.notEqual(result.status, 0);
  assert.equal(f.requests.length, 1);
  assert.ok(Date.now() - started < 4000);
  assert.equal(result.stdout, "");
  assert.doesNotMatch(result.stderr, /fictional/u);
});

test("invalid origin, path, headers and flags never reach the network", async (t) => {
  const f = await fixture(t, (_request, response) =>
    response.end("unexpected"),
  );
  const invalid = [
    args("/api/status", "http://fixture.vercel.app"),
    args("/api/status", "https://fixture.vercel.app.evil.example"),
    args("/api/status", "https://user:password@fixture.vercel.app"),
    args("/api/status", "https://fixture.vercel.app:8443"),
    args("/api/status", "https://fixture.vercel.app/path"),
    args("/api/status", "https://fixture.vercel.app?query=1"),
    args("//other.vercel.app/"),
    args("/\\other.vercel.app/"),
    args("/api/status#fragment"),
    args("/api/status\nheader"),
    [...args(), "--location"],
    [...args(), "--token=fictional-token"],
    [...args().slice(0, -1), "0"],
  ];
  for (const arguments_ of invalid) {
    const result = await f.run(arguments_);
    assert.notEqual(result.status, 0, JSON.stringify(arguments_));
    assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, /fictional|password/u);
  }
  const header = await f.run(args(), {
    VERCEL_AUTOMATION_BYPASS_SECRET: "bad\r\nheader",
  });
  assert.notEqual(header.status, 0);
  const absent = await f.run(
    args().filter((arg) => !arg.startsWith("--protection-bypass=")),
    {
      VERCEL_AUTOMATION_BYPASS_SECRET: "",
    },
  );
  assert.notEqual(absent.status, 0);
  assert.equal(f.requests.length, 0);
});
