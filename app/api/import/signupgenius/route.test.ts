import { beforeEach, expect, mock, test } from "bun:test";
import { SignUpGeniusImportError } from "@/lib/signupgenius/errors";

let fetches = 0;
let quotaCalls = 0;
let allowed = true;
let quotaUnavailable = false;
let parseError: SignUpGeniusImportError | null = null;
const preview = {
  sourceUrl: "https://www.signupgenius.com/go/10C0B4CAEAD2EA6FEC34",
  title: "Fictional cleanup",
  description: "Bring water.",
  location: "Fictional park",
  timezone: null,
  slots: [
    {
      name: "Setup",
      date: "2025-10-12",
      startTime: "09:00",
      endTime: "10:00",
      capacity: 4,
    },
  ],
};
mock.module("@/lib/ai/rate-limit", () => ({
  consumeAiQuota: async () => {
    quotaCalls++;
    if (quotaUnavailable) throw new Error("private backend failure");
    return { allowed, resetAt: new Date(Date.now() + 60000).toISOString() };
  },
}));
mock.module("@/services/signupgenius-fetch", () => ({
  fetchPublicSignUpGenius: async () => {
    fetches++;
    return { html: "synthetic", sourceUrl: preview.sourceUrl };
  },
}));
mock.module("@/services/signupgenius-parser", () => ({
  parsePublicSignUpGenius: () => {
    if (parseError) throw parseError;
    return preview;
  },
}));
const { POST } = await import("./route");
function request(
  body: unknown = { url: preview.sourceUrl },
  headers: Record<string, string> = {},
) {
  return new Request("https://example.test/api/import/signupgenius", {
    method: "POST",
    headers: {
      origin: "https://example.test",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  fetches = 0;
  quotaCalls = 0;
  allowed = true;
  quotaUnavailable = false;
  parseError = null;
});
test("returns validated event projection without source HTML or participant fields", async () => {
  const res = await POST(request());
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(await res.json()).toEqual({ preview });
  expect(fetches).toBe(1);
});
test("refuses cross-origin, malformed, arbitrary and oversized inputs before fetching", async () => {
  expect(
    (await POST(request(undefined, { origin: "https://other.test" }))).status,
  ).toBe(403);
  expect(
    (await POST(request({ url: "https://localhost/private" }))).status,
  ).toBe(400);
  expect(
    (await POST(request({ url: preview.sourceUrl, attendees: [] }))).status,
  ).toBe(400);
  expect((await POST(request({ url: "x".repeat(5000) }))).status).toBe(400);
  expect(fetches).toBe(0);
  expect(quotaCalls).toBe(0);
});
test("fails closed when durable rate limiting is unavailable or exhausted", async () => {
  allowed = false;
  const res = await POST(request());
  expect(res.status).toBe(429);
  expect(res.headers.get("retry-after")).toBeTruthy();
  expect(fetches).toBe(0);
  quotaUnavailable = true;
  expect((await POST(request())).status).toBe(503);
  expect(fetches).toBe(0);
});
test("unsupported, challenge and incomplete sources are errors, never previews", async () => {
  for (const code of ["unsupported", "challenge", "incomplete"] as const) {
    parseError = new SignUpGeniusImportError(code);
    const res = await POST(request());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe(code);
    expect(body.preview).toBeUndefined();
  }
});
