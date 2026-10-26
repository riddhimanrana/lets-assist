import { beforeEach, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

let authenticated = true;
let generated = 0;
let candidate: Record<string, unknown>;
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => ({
    user: authenticated ? { id: "synthetic-user" } : null,
    error: null,
  }),
}));
mock.module("@/lib/ai/parse-project-rate-limit", () => ({
  consumeParseProjectQuota: async () => ({
    allowed: true,
    remaining: 19,
    resetAt: "2027-01-01T00:00:00Z",
  }),
}));
mock.module("@/lib/ai/with-ai-tracking", () => ({
  prepareTrackedAiCall: () => ({
    model: "synthetic-model",
    telemetry: {},
    gatewayOptions: {},
    logUsage: async () => {},
  }),
}));
mock.module("ai", () => ({
  generateText: async () => {
    generated++;
    return { text: JSON.stringify(candidate), usage: {} };
  },
}));
const { POST } = await import("./route");

beforeEach(() => {
  authenticated = true;
  generated = 0;
  candidate = {
    title: "Community cleanup",
    description: "Help clean up a community space.",
    eventType: "oneTime",
    schedule: {
      date: "2027-01-09",
      startTime: "09:00",
      endTime: "12:00",
      volunteers: 20,
    },
    verificationMethod: "qr-code",
    requireLogin: true,
    recurrence: { enabled: false },
  };
});
function request(prompt = "Community cleanup Saturday morning") {
  return new NextRequest("https://example.test/api/ai/parse-project", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, timezone: "America/Los_Angeles" }),
  });
}
test.each([undefined, ""])(
  "a valid generated draft without a location is returned for organizer review (%s)",
  async (location) => {
    if (location !== undefined) candidate.location = location;
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      title: "Community cleanup",
      location: "",
      eventType: "oneTime",
    });
    expect(generated).toBe(1);
  },
);
test("malformed schedule output is still refused", async () => {
  candidate.schedule = {
    date: "2027-01-09",
    startTime: "bad",
    endTime: "12:00",
    volunteers: 20,
  };
  expect((await POST(request())).status).toBe(502);
});
test("unauthenticated and too-short requests do not call the provider", async () => {
  authenticated = false;
  expect((await POST(request())).status).toBe(401);
  authenticated = true;
  expect((await POST(request("cleanup"))).status).toBe(400);
  expect(generated).toBe(0);
});
