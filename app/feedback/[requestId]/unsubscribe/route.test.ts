import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const REQUEST_ID = "feedback-request-1";
const USER_ID = "user-1";
const ANONYMOUS_ID = "anonymous-1";
const PROJECT_ID = "project-1";
const writes: Array<{ table: string; values: Record<string, unknown> }> = [];
const rpcWrites: Array<{
  functionName: string;
  values: Record<string, unknown>;
}> = [];
let feedbackSubject: { user_id: string | null; anonymous_id: string | null };

class Query {
  constructor(private readonly table: string) {}
  select() {
    return this;
  }
  eq() {
    return this;
  }
  async maybeSingle() {
    return {
      data: { id: REQUEST_ID, ...feedbackSubject },
      error: null,
    };
  }
  async upsert(values: Record<string, unknown>) {
    writes.push({ table: this.table, values });
    return { error: null };
  }
  update(values: Record<string, unknown>) {
    writes.push({ table: this.table, values });
    return this;
  }
}

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => new Query(table),
    rpc: async (functionName: string, values: Record<string, unknown>) => {
      rpcWrites.push({ functionName, values });
      return { error: null };
    },
  }),
}));

process.env.PROJECT_FEEDBACK_TOKEN_SECRET =
  "synthetic-project-feedback-secret-value";

const route = await import("./route");
const { createProjectFeedbackToken } =
  await import("@/services/project-feedback-token");
const { NextRequest } = await import("next/server");

function token(
  subject:
    | { kind: "user"; userId: string }
    | { kind: "anonymous"; anonymousSignupId: string } = {
    kind: "user",
    userId: USER_ID,
  },
) {
  return createProjectFeedbackToken({
    projectId: PROJECT_ID,
    requestId: REQUEST_ID,
    subject,
  });
}

function context() {
  return { params: Promise.resolve({ requestId: REQUEST_ID }) };
}

beforeEach(() => {
  writes.splice(0);
  rpcWrites.splice(0);
  feedbackSubject = { user_id: USER_ID, anonymous_id: null };
});

describe("project feedback unsubscribe confirmation", () => {
  test("GET is scanner-safe and only renders a POST confirmation", async () => {
    const issued = token();
    const request = new NextRequest(
      `https://example.test/feedback/${REQUEST_ID}/unsubscribe?token=${issued}`,
    );

    const response = await route.GET(request, context());
    const html = await response.text();

    expect(writes).toHaveLength(0);
    expect(html).toContain('<form method="post"');
    expect(html).toContain(`name="token" value="${issued}"`);
    expect(html).not.toContain(`action="/feedback/${REQUEST_ID}/unsubscribe?`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  test("POST applies the explicit unsubscribe decision", async () => {
    const body = new FormData();
    body.set("token", token());
    body.set("decision", "unsubscribe");
    const request = new NextRequest(
      `https://example.test/feedback/${REQUEST_ID}/unsubscribe`,
      { method: "POST", body },
    );

    const response = await route.POST(request, context());

    expect(writes).toEqual([
      {
        table: "notification_settings",
        values: { user_id: USER_ID, project_updates: false },
      },
    ]);
    expect(await response.text()).toContain("turned off");
  });

  test("anonymous POST propagates the address-level decision through the service RPC", async () => {
    feedbackSubject = { user_id: null, anonymous_id: ANONYMOUS_ID };
    const body = new FormData();
    body.set(
      "token",
      token({ kind: "anonymous", anonymousSignupId: ANONYMOUS_ID }),
    );
    body.set("decision", "unsubscribe");
    const request = new NextRequest(
      `https://example.test/feedback/${REQUEST_ID}/unsubscribe`,
      { method: "POST", body },
    );

    const response = await route.POST(request, context());

    expect(rpcWrites).toEqual([
      {
        functionName: "set_anonymous_feedback_email_opt_out",
        values: {
          p_anonymous_signup_id: ANONYMOUS_ID,
          p_opted_out: true,
        },
      },
    ]);
    expect(await response.text()).toContain("this address won&#39;t receive");
  });

  test("an invalid GET and POST never write", async () => {
    const get = new NextRequest(
      `https://example.test/feedback/${REQUEST_ID}/unsubscribe?token=forged`,
    );
    const body = new FormData();
    body.set("token", "forged");
    body.set("decision", "unsubscribe");
    const post = new NextRequest(
      `https://example.test/feedback/${REQUEST_ID}/unsubscribe`,
      { method: "POST", body },
    );

    await route.GET(get, context());
    await route.POST(post, context());
    expect(writes).toHaveLength(0);
    expect(rpcWrites).toHaveLength(0);
  });
});
