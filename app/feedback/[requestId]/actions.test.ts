import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
mock.module("server-only", () => ({}));
mock.module("./FeedbackTokenClient", () => ({
  FeedbackTokenClient: () => null,
}));
const requestId = "aa000000-0000-4000-8000-000000000001";
const projectId = "aa000000-0000-4000-8000-000000000002";
const userId = "aa000000-0000-4000-8000-000000000003";
const anonymousId = "aa000000-0000-4000-8000-000000000004";
let request: {
  project_id: string;
  user_id: string | null;
  anonymous_id: string | null;
  purpose: string;
};
let fail = false;
const writes: Array<{ name: string; args: Record<string, unknown> }> = [];
class Query {
  constructor(private table: string) {}
  select() {
    return this;
  }
  eq() {
    return this;
  }
  async maybeSingle() {
    return {
      error: null,
      data:
        this.table === "project_feedback_requests"
          ? request
          : this.table === "projects"
            ? { id: projectId, title: "Fictional garden project" }
            : null,
    };
  }
}
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => new Query(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      writes.push({ name, args });
      return { error: fail ? { message: "unavailable" } : null };
    },
  }),
}));
process.env.PROJECT_FEEDBACK_TOKEN_SECRET =
  "synthetic-platform-feedback-test-secret";
const { createProjectFeedbackToken } =
  await import("@/services/project-feedback-token");
const { saveExperienceFeedbackWithToken } = await import("./actions");
const { default: Page } = await import("./page");
function token(anonymous = false) {
  return createProjectFeedbackToken({
    requestId,
    projectId,
    subject: anonymous
      ? { kind: "anonymous", anonymousSignupId: anonymousId }
      : { kind: "user", userId },
  });
}
beforeEach(() => {
  writes.length = 0;
  fail = false;
  request = {
    project_id: projectId,
    user_id: userId,
    anonymous_id: null,
    purpose: "platform_experience",
  };
});
describe("platform experience interaction", () => {
  test("a scanner landing with a rating parameter never writes", async () => {
    const result = await Page({
      params: Promise.resolve({ requestId }),
      searchParams: Promise.resolve({ token: token(), rating: "5" }),
    });
    const html = renderToStaticMarkup(result);
    expect(html).toContain("How was using Let");
    expect(html).not.toContain('aria-checked="true"');
    expect(writes).toHaveLength(0);
  });
  test("rating and comment interactions stay independent", async () => {
    expect(
      await saveExperienceFeedbackWithToken(requestId, token(), { rating: 4 }),
    ).toEqual({ success: true });
    expect(writes[0].args).toEqual({
      p_request_id: requestId,
      p_rating: 4,
      p_comment: null,
      p_update_comment: false,
    });
    expect(
      await saveExperienceFeedbackWithToken(requestId, token(), {
        comment: "  Easier on my phone  ",
      }),
    ).toEqual({ success: true });
    expect(writes[1].args).toEqual({
      p_request_id: requestId,
      p_rating: null,
      p_comment: "Easier on my phone",
      p_update_comment: true,
    });
  });
  test("anonymous interaction uses only its signed request identity", async () => {
    request.user_id = null;
    request.anonymous_id = anonymousId;
    expect(
      (
        await saveExperienceFeedbackWithToken(requestId, token(true), {
          rating: 5,
        })
      ).success,
    ).toBe(true);
    expect(
      (await saveExperienceFeedbackWithToken(requestId, token(), { rating: 1 }))
        .success,
    ).toBe(false);
    expect(writes).toHaveLength(1);
  });
  test("mismatched purpose, project and subject never write", async () => {
    for (const field of ["purpose", "project_id", "user_id"] as const) {
      const original = request[field];
      request[field] = "different";
      expect(
        (
          await saveExperienceFeedbackWithToken(requestId, token(), {
            rating: 4,
          })
        ).success,
      ).toBe(false);
      request[field] = original!;
    }
    expect(writes).toHaveLength(0);
  });
  test("invalid, expired and mixed inputs do not write", async () => {
    for (const input of [
      { rating: 0 },
      { rating: 6 },
      { rating: 2.5 },
      { rating: 4, comment: "mixed" },
      { comment: "x".repeat(2001) },
    ]) {
      expect(
        (await saveExperienceFeedbackWithToken(requestId, token(), input))
          .success,
      ).toBe(false);
    }
    expect(
      (
        await saveExperienceFeedbackWithToken(requestId, "expired", {
          rating: 4,
        })
      ).success,
    ).toBe(false);
    expect(writes).toHaveLength(0);
  });
  test("database failures remain failures so the draft can retry", async () => {
    fail = true;
    expect(
      (
        await saveExperienceFeedbackWithToken(requestId, token(), {
          comment: "Keep my draft",
        })
      ).success,
    ).toBe(false);
    fail = false;
    expect(
      (
        await saveExperienceFeedbackWithToken(requestId, token(), {
          comment: "Keep my draft",
        })
      ).success,
    ).toBe(true);
  });
});
