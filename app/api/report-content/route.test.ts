import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * HTTP behavior of the report route, exercised through the real handler with
 * the auth boundary, the domain service, and the notification fan-out replaced
 * by recorders.
 */

mock.module("server-only", () => ({}));

type AuthResult = {
  user: { id: string } | null;
  error: { message: string } | null;
};

let authResult: AuthResult = { user: { id: "reporter" }, error: null };
let authOptions: Array<Record<string, unknown> | undefined> = [];

type ServiceResult = Record<string, unknown>;
let serviceResult: ServiceResult = {
  status: "created",
  reportId: "30000000-0000-4000-8000-000000000001",
};
let serviceCalls: Array<Record<string, unknown>> = [];
let serviceBehavior: (() => ServiceResult) | null = null;

let notifications: Array<Record<string, unknown>> = [];
let notificationFails = false;

let infoLogs: Array<{ message: string; attributes?: Record<string, unknown> }> =
  [];
let afterCallbacks: Array<() => Promise<void>> = [];

mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async (options?: Record<string, unknown>) => {
    authOptions.push(options);
    return authResult;
  },
}));

mock.module("@/lib/moderation/content-report-service", () => ({
  submitContentReport: async (input: Record<string, unknown>) => {
    serviceCalls.push(input);
    return serviceBehavior ? serviceBehavior() : serviceResult;
  },
}));

mock.module("@/services/admin-notifications", () => ({
  notifyAdminsBatched: async (payload: Record<string, unknown>) => {
    notifications.push(payload);
    if (notificationFails) throw new Error("notification transport down");
  },
}));

mock.module("@/lib/logger", () => ({
  logError: () => {},
  logInfo: (message: string, attributes?: Record<string, unknown>) => {
    infoLogs.push({ message, attributes });
  },
  flushLogs: async () => {},
}));

const nextServer = await import("next/server");
mock.module("next/server", () => ({
  ...nextServer,
  after: (callback: () => Promise<void>) => {
    afterCallbacks.push(callback);
  },
}));

const { POST } = await import("./route");

const CONTENT_ID = "10000000-0000-4000-8000-000000000001";

const validBody = {
  contentType: "project",
  contentId: CONTENT_ID,
  reason: "spam",
  description: "This project contains repeated promotional content.",
};

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://lets-assist.com/api/report-content", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  authResult = { user: { id: "reporter" }, error: null };
  authOptions = [];
  serviceResult = {
    status: "created",
    reportId: "30000000-0000-4000-8000-000000000001",
  };
  serviceCalls = [];
  serviceBehavior = null;
  notifications = [];
  notificationFails = false;
  infoLogs = [];
  afterCallbacks = [];
});

afterEach(() => {
  afterCallbacks = [];
});

describe("authentication boundary", () => {
  test("an anonymous request is refused before any domain work", async () => {
    authResult = { user: null, error: null };

    const response = await POST(request(validBody));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "You must be signed in to report content.",
    });
    expect(serviceCalls).toHaveLength(0);
  });

  test("the actor is revalidated against the auth server, not just the JWT", async () => {
    await POST(request(validBody));
    expect(authOptions).toEqual([{ sensitive: true }]);
  });

  test("an auth outage fails closed with a retry hint", async () => {
    authResult = { user: null, error: { message: "auth upstream 500" } };

    const response = await POST(request(validBody));

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(await response.text()).not.toContain("auth upstream");
    expect(serviceCalls).toHaveLength(0);
  });
});

describe("input boundary", () => {
  test("malformed JSON is refused", async () => {
    const response = await POST(request("{not json"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid report details" });
    expect(serviceCalls).toHaveLength(0);
  });

  test("an oversized declared body is refused with 413", async () => {
    const response = await POST(
      request(validBody, { "content-length": String(64 * 1024) }),
    );

    expect(response.status).toBe(413);
    expect(serviceCalls).toHaveLength(0);
  });

  test("server-owned moderation fields cannot be submitted", async () => {
    for (const body of [
      { ...validBody, status: "resolved" },
      { ...validBody, priority: "high" },
      { ...validBody, reporter_id: "someone-else" },
      { ...validBody, contentId: "not-a-uuid" },
      { ...validBody, reason: "made_up" },
      { ...validBody, description: "too short" },
    ]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
    }

    expect(serviceCalls).toHaveLength(0);
  });

  test("a valid submission reaches the service with the parsed payload", async () => {
    await POST(request({ ...validBody, url: "/projects/abc" }));

    expect(serviceCalls).toHaveLength(1);
    expect(serviceCalls[0]?.reporterId).toBe("reporter");
    expect(serviceCalls[0]?.submission).toEqual({
      ...validBody,
      url: "/projects/abc",
    });
    expect(serviceCalls[0]?.requestHeaders).toBeInstanceOf(Headers);
  });
});

describe("outcome mapping", () => {
  test("a created report returns after its transaction-owned alert is durable", async () => {
    const response = await POST(request(validBody));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      reportId: "30000000-0000-4000-8000-000000000001",
      message: "Report submitted successfully",
    });
    expect(notifications).toHaveLength(0);
  });

  test("a replayed submission returns the original report without re-notifying", async () => {
    serviceResult = {
      status: "replayed",
      reportId: "30000000-0000-4000-8000-000000000001",
    };

    const response = await POST(request(validBody));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      reportId: "30000000-0000-4000-8000-000000000001",
      message: "Report submitted successfully",
    });
    expect(notifications).toHaveLength(0);
  });

  test("a retried submission is indistinguishable to the client", async () => {
    const calls = ["created", "replayed"];
    serviceBehavior = () => ({
      status: calls.shift(),
      reportId: "30000000-0000-4000-8000-000000000001",
    });

    const first = await POST(request(validBody));
    const second = await POST(request(validBody));

    expect(first.status).toBe(second.status);
    expect(await first.json()).toEqual(await second.json());
    expect(notifications).toHaveLength(0);
  });

  test("a rejected target is a generic 400", async () => {
    serviceResult = { status: "invalid_input" };

    const response = await POST(request(validBody));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid report details" });
  });

  test("an exhausted quota returns 429 with Retry-After", async () => {
    serviceResult = { status: "rate_limited", retryAfterSeconds: 270 };

    const response = await POST(request(validBody));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("270");
    expect(notifications).toHaveLength(0);
  });

  test("an unavailable dependency returns 503 and no notification", async () => {
    serviceResult = { status: "unavailable" };

    const response = await POST(request(validBody));

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(notifications).toHaveLength(0);
  });

  test("an unexpected failure is a generic 500", async () => {
    serviceBehavior = () => {
      throw new Error("boom: postgres://user:password@db/internal");
    };

    const response = await POST(request(validBody));

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("postgres://");
  });
});

describe("observability", () => {
  test("success logs carry no reporter identity or target identifier", async () => {
    await POST(request(validBody));

    expect(infoLogs).toHaveLength(1);
    const serialized = JSON.stringify(infoLogs[0]);
    expect(serialized).not.toContain("reporter");
    expect(serialized).not.toContain(CONTENT_ID);
    expect(infoLogs[0]?.attributes).toMatchObject({
      content_type: "project",
      reason: "spam",
      replayed: false,
    });
  });

  test("log flushing is deferred to after the response", async () => {
    await POST(request(validBody));
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]?.();
  });
});
