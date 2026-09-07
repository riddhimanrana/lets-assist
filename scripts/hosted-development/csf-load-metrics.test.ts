import { describe, expect, test } from "bun:test";

import { createHostedReadMetrics } from "./csf-load-metrics.mjs";

describe("hosted read diagnostics", () => {
  test("keeps role and route latency separate", () => {
    const metrics = createHostedReadMetrics();
    for (let durationMs = 1; durationMs <= 100; durationMs += 1) {
      metrics.record({
        role: "member",
        routeIndex: 1,
        durationMs,
        status: 200,
      });
    }
    metrics.record({
      role: "officer",
      routeIndex: 1,
      durationMs: 4000,
      status: 200,
    });
    expect(metrics.summarize()).toEqual([
      {
        role: "member",
        route: "profile",
        requests: 100,
        p50Ms: 50,
        p95Ms: 95,
        p99Ms: 99,
        outcomes: { http_200: 100 },
      },
      {
        role: "officer",
        route: "applications",
        requests: 1,
        p50Ms: 4000,
        p95Ms: 4000,
        p99Ms: 4000,
        outcomes: { http_200: 1 },
      },
    ]);
  });

  test("distinguishes timeout, failed transport, redirects, and server errors", () => {
    const metrics = createHostedReadMetrics();
    for (const outcome of [
      { failure: "timeout" },
      { failure: "network" },
      { status: 307 },
      { status: 503 },
    ]) {
      metrics.record({
        role: "member",
        routeIndex: 0,
        durationMs: 100,
        ...outcome,
      });
    }
    expect(metrics.summarize()[0].outcomes).toEqual({
      timeout: 1,
      request_failure: 1,
      http_307: 1,
      http_503: 1,
    });
  });

  test("does not retain arbitrary error text, URLs, or identities", () => {
    const metrics = createHostedReadMetrics();
    const privateText = "private@example.test secret-cookie student-name";
    metrics.record({
      role: "officer",
      routeIndex: 2,
      durationMs: 1,
      failure: privateText,
      status: privateText,
    });
    expect(JSON.stringify(metrics.summarize())).not.toContain(privateText);
    expect(() =>
      metrics.record({ role: privateText, routeIndex: 0, durationMs: 1 }),
    ).toThrow("Invalid hosted request metric.");
    expect(() =>
      metrics.record({ role: "member", routeIndex: 99, durationMs: 1 }),
    ).toThrow("Invalid hosted request metric.");
  });

  test("empty and repeated summaries do not mutate collected counts", () => {
    const metrics = createHostedReadMetrics();
    expect(metrics.summarize()).toEqual([]);
    metrics.record({
      role: "member",
      routeIndex: 0,
      durationMs: 1,
      status: 200,
    });
    const result = metrics.summarize();
    result[0].outcomes.http_200 = 900;
    expect(metrics.summarize()[0].outcomes.http_200).toBe(1);
  });
});
