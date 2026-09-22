import { describe, expect, test } from "bun:test";
import { createBrowserDiagnostics } from "./browser-diagnostics.mjs";

const event = {
  kind: "console_error",
  role: "officer",
  pageUrl:
    "https://dev.lets-assist.com/organization/fictional?tab=csf-applications&token=private-query",
  url: "https://dev.lets-assist.com/_next/static/chunks/example.js?key=private-key",
  text: "Failed to load resource: the server responded with a status of 404 ()",
};

describe("hosted browser diagnostics", () => {
  test("identifies the failed resource and route without exposing raw evidence", () => {
    const emitted: unknown[] = [];
    const recorder = createBrowserDiagnostics((sample: unknown) =>
      emitted.push(sample),
    );
    recorder.record(event);
    expect(emitted[0]).toMatchObject({
      kind: "console_error",
      role: "officer",
      route: "csf-applications",
      resource: { origin: "application", path: "next_static" },
      category: "http",
      code: 404,
    });
    const output = JSON.stringify(recorder.summarize());
    for (const sensitive of [
      "private-query",
      "private-key",
      "example.js",
      "fictional",
      event.text,
    ]) {
      expect(output).not.toContain(sensitive);
    }
  });

  test("unknown messages and external URLs remain opaque", () => {
    const recorder = createBrowserDiagnostics();
    recorder.record({
      ...event,
      text: "student@example.test bearer-secret session-cookie",
      url: "https://private.example.test/student-name?access_token=secret",
      pageUrl: "https://private.example.test/?tab=csf-applications",
    });
    const result = recorder.summarize();
    expect(result.samples[0]).toMatchObject({
      category: "unclassified",
      route: "unknown",
      resource: { origin: "external", path: "other" },
    });
    for (const sensitive of [
      "student",
      "example.test",
      "secret",
      "session-cookie",
    ]) {
      expect(JSON.stringify(result)).not.toContain(sensitive);
    }
  });

  test("recognizes React and browser network failures", () => {
    const recorder = createBrowserDiagnostics();
    recorder.record({
      ...event,
      text: "Minified React error #418; see private-url",
    });
    recorder.record({
      ...event,
      text: "Failed to load resource: net::ERR_CONNECTION_CLOSED",
    });
    recorder.record({
      ...event,
      text: "Failed to fetch RSC payload for private-url",
    });
    expect(
      recorder
        .summarize()
        .samples.map(
          ({ category, code }: { category: string; code?: unknown }) => ({
            category,
            code,
          }),
        ),
    ).toEqual([
      { category: "react", code: 418 },
      { category: "network", code: "ERR_CONNECTION_CLOSED" },
      { category: "rsc_fetch", code: undefined },
    ]);
  });

  test("records HTTP errors even when Playwright does not emit requestfailed", () => {
    const recorder = createBrowserDiagnostics();
    recorder.record({
      ...event,
      kind: "http_error",
      text: "",
      status: 429,
      url: "https://ocbuygudvarsuxijxhau.supabase.co/auth/v1/token?grant_type=password",
    });
    expect(recorder.summarize().samples[0]).toMatchObject({
      status: 429,
      resource: { origin: "development_database", path: "auth" },
    });
  });

  test("caps samples while retaining the full diagnostic count", () => {
    const recorder = createBrowserDiagnostics();
    for (let index = 0; index < 45; index++) recorder.record(event);
    const result = recorder.summarize();
    expect(result.total).toBe(45);
    expect(result.omitted).toBe(15);
    expect(result.samples).toHaveLength(30);
    result.samples.length = 0;
    expect(recorder.summarize().samples).toHaveLength(30);
  });

  test("rejects arbitrary kinds and roles and handles missing URLs", () => {
    const recorder = createBrowserDiagnostics();
    recorder.record({ ...event, role: "secret-role" });
    recorder.record({ ...event, kind: "secret-kind" });
    recorder.record({
      ...event,
      url: undefined,
      pageUrl: undefined,
      status: "secret-status",
    });
    const result = recorder.summarize();
    expect(result.total).toBe(1);
    expect(result.samples[0]).toMatchObject({
      route: "unknown",
      resource: { origin: "unknown", path: "unknown" },
    });
    expect(result.samples[0]).not.toHaveProperty("status");
  });
});
