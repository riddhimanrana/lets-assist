import { beforeEach, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const org = "73000000-0000-4000-8000-000000000001";
const actor = "73000000-0000-4000-8000-000000000002";
const term = "73000000-0000-4000-8000-000000000003";
const activity = "73000000-0000-4000-8000-000000000004";
const request = "73000000-0000-4000-8000-000000000005";
const unknownOutcome =
  "The activity request could not be confirmed. Authorization may have changed or the outcome may be unknown. Reload Activities before trying again.";
let rpcError: { message: string } | null = null;
let calls: { name: string; payload: Record<string, unknown> }[] = [];
const revalidate = mock(() => {});
const email = mock(async () => ({ queued: false, message: "Not requested" }));
mock.module("next/cache", () => ({ revalidatePath: revalidate }));
mock.module("@/lib/security/html.server", () => ({
  sanitizeRichTextHtml: (value: string) => value,
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => {
    throw new Error("This fixture must not access linked projects");
  },
}));
mock.module(
  "@/lib/plugins/private/plugins/dvhs-csf/services/activity-email",
  () => ({
    CsfActivityEmailQueueOutcomeError: class extends Error {},
    queueActivityEmail: email,
  }),
);
mock.module(
  "@/lib/plugins/private/plugins/dvhs-csf/server/actions/support-authorization",
  () => ({ getAuthorizedStaffContext: async () => ({ userId: actor }) }),
);
mock.module("@/lib/plugins/supabase", () => ({
  createPluginAdminClient: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data:
            table === "csf_terms"
              ? { id: term, lifecycle_status: "open" }
              : { id: activity, status: "published" },
          error: null,
        }),
      };
      return chain;
    },
    rpc: async (name: string, payload: Record<string, unknown>) => {
      calls.push({ name, payload });
      return { data: null, error: rpcError };
    },
  }),
}));
const { updateCsfOpportunityAction, setCsfActivityStatusAction } =
  await import("@/lib/plugins/private/plugins/dvhs-csf/server/actions/opportunities");

function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    requestId: request,
    activityId: activity,
    termCode: "F26",
    title: "Fictional undated activity",
    status: "published",
    signupMode: "none",
    pointValue: "1",
  }))
    data.set(key, value);
  return data;
}
beforeEach(() => {
  calls = [];
  rpcError = null;
  revalidate.mockClear();
  email.mockClear();
});

test.each([undefined, "", "   "])(
  "published activity edit normalizes absent or blank dates (%s) to null",
  async (blank) => {
    const data = form();
    if (blank !== undefined) {
      data.set("startsAt", blank);
      data.set("endsAt", blank);
    }
    expect(await updateCsfOpportunityAction(org, data)).toEqual({
      success: true,
      message: "Activity updated.",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      name: "csf_update_activity",
      payload: {
        p_organization_id: org,
        p_activity_id: activity,
        p_term_id: term,
        p_actor_user_id: actor,
        p_request_id: request,
        p_activity: { startsAt: null, endsAt: null, pointCap: null },
      },
    });
    expect(revalidate).toHaveBeenCalledTimes(1);
  },
);

test("undated draft publication reaches the atomic status action without inventing dates", async () => {
  expect(await setCsfActivityStatusAction(org, form())).toEqual({
    success: true,
    message: "Activity published. No announcement requested.",
  });
  expect(calls).toEqual([
    {
      name: "csf_set_activity_status_with_email",
      payload: {
        p_organization_id: org,
        p_activity_id: activity,
        p_status: "published",
        p_reason: null,
        p_email_requested: false,
        p_email_topic: null,
        p_actor_user_id: actor,
        p_request_id: request,
      },
    },
  ]);
  expect(revalidate).toHaveBeenCalledTimes(1);
  expect(email).not.toHaveBeenCalled();
});

test.each(["edit", "publish"])(
  "undated %s propagates an unconfirmed RPC outcome without success or email",
  async (operation) => {
    rpcError = { message: "Private database validation details" };
    const result =
      operation === "edit"
        ? await updateCsfOpportunityAction(org, form())
        : await setCsfActivityStatusAction(org, form());
    expect(result).toEqual({
      success: false,
      error: unknownOutcome,
      // Both replay under the request id they already sent. Each RPC carries
      // its own receipt, so minting a fresh id could run a change that did
      // commit a second time.
      retrySameRequest: true,
      // Only the edit asks for a reload. It may already have written before the
      // outcome stopped being provable, so the page the officer is looking at
      // can be stale; the status action has nothing local left to reconcile.
      ...(operation === "edit" ? { reloadRequired: true } : {}),
    });
    expect(calls).toHaveLength(1);
    expect(revalidate).not.toHaveBeenCalled();
    expect(email).not.toHaveBeenCalled();
  },
);

test("an end without a start fails before the edit RPC", async () => {
  const data = form();
  data.set("endsAt", "2026-09-15T12:00");
  expect(await updateCsfOpportunityAction(org, data)).toEqual({
    success: false,
    error: "Add a start before giving the activity an end time.",
  });
  expect(calls).toHaveLength(0);
  expect(revalidate).not.toHaveBeenCalled();
});
