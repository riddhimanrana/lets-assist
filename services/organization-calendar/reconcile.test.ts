import { expect, mock, test } from "bun:test";
import type { writeOrganizationCalendarEvent } from "./provider";
mock.module("server-only", () => ({}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => {
    throw new Error("Unexpected real database access");
  },
}));
const { reconcileOrganizationCalendar } = await import("./reconcile");
const token = "ab000000-0000-4000-8000-000000000001";
const receipt = {
  id: "ab000000-0000-4000-8000-000000000002",
  calendar_id: "pinned@example.test",
  event_id: "la0001234",
  phase: "pending_create",
  event_payload: { summary: "Synthetic" },
};
const options = {
  userId: "actor",
  organizationId: "org",
  calendarId: "current@example.test",
  accessToken: "fictional",
  sourceKinds: ["project_schedule" as const],
  load: async () => [],
};
function harness() {
  let pending: typeof receipt | null = { ...receipt };
  let failComplete = false;
  let failPlan = false;
  let failClaim = false;
  let failRenew = false;
  let renewValue: unknown = {};
  const steps: string[] = [];
  const rpc = mock(async (name: string, args: Record<string, unknown>) => {
    if (name === "claim_organization_calendar_sync")
      return { data: token, error: failClaim ? {} : null };
    const step = String(args.p_step);
    steps.push(step);
    if (step === "plan" && failPlan) return { data: null, error: {} };
    if (step === "renew")
      return { data: renewValue, error: failRenew ? {} : null };
    if (step === "next") return { data: pending, error: null };
    if (step === "complete") {
      if (failComplete) return { data: null, error: {} };
      pending = null;
    }
    if (step === "missing" && pending)
      pending = { ...pending, phase: "pending_create", event_id: "lanew1234" };
    return { data: {}, error: null };
  });
  const write = mock(
    async (_options: Parameters<typeof writeOrganizationCalendarEvent>[0]) =>
      "confirmed" as "confirmed" | "missing" | "unconfirmed",
  );
  const remove = mock(
    async (
      _token: string,
      _calendar: string,
      _id: string,
      _beforeWrite?: () => Promise<unknown>,
    ) => true,
  );
  return {
    deps: { rpc, write, remove, now: () => 0 },
    steps,
    pending: (value: typeof pending) => {
      pending = value;
    },
    failComplete: (value: boolean) => {
      failComplete = value;
    },
    failPlan: () => {
      failPlan = true;
    },
    failClaim: () => {
      failClaim = true;
    },
    failRenew: () => {
      failRenew = true;
    },
    renewValue: (value: unknown) => {
      renewValue = value;
    },
  };
}
test("receipt plan is durable before any event write", async () => {
  const h = harness();
  h.deps.write.mockImplementation(async () => {
    expect(h.steps).toEqual(["plan", "next"]);
    return "confirmed";
  });
  expect(await reconcileOrganizationCalendar(options, h.deps)).toEqual({
    success: true,
    createdCount: 1,
    updatedCount: 0,
    removedCount: 0,
  });
  expect(h.steps).toEqual(["plan", "next", "complete", "next", "finish"]);
});
test("lost DB completion keeps the same ID without compensation deletion", async () => {
  const h = harness();
  h.failComplete(true);
  expect((await reconcileOrganizationCalendar(options, h.deps)).success).toBe(
    false,
  );
  expect(h.deps.remove).not.toHaveBeenCalled();
  expect(h.steps).not.toContain("finish");
  h.failComplete(false);
  expect((await reconcileOrganizationCalendar(options, h.deps)).success).toBe(
    true,
  );
  expect(h.deps.write.mock.calls.map((call) => call[0].eventId)).toEqual([
    receipt.event_id,
    receipt.event_id,
  ]);
});
test("claim and complete source loading must succeed before writes", async () => {
  const h = harness();
  h.failClaim();
  const load = mock(async () => []);
  expect(
    (await reconcileOrganizationCalendar({ ...options, load }, h.deps)).success,
  ).toBe(false);
  expect(load).not.toHaveBeenCalled();
  expect(h.deps.write).not.toHaveBeenCalled();
  const second = harness();
  expect(
    (
      await reconcileOrganizationCalendar(
        {
          ...options,
          load: async () => {
            throw new Error("source failed");
          },
        },
        second.deps,
      )
    ).success,
  ).toBe(false);
  expect(second.steps).toEqual(["release"]);
  expect(second.deps.write).not.toHaveBeenCalled();
});
test("a refused plan cannot delete or create provider events", async () => {
  const h = harness();
  h.failPlan();
  expect((await reconcileOrganizationCalendar(options, h.deps)).success).toBe(
    false,
  );
  expect(h.deps.write).not.toHaveBeenCalled();
  expect(h.deps.remove).not.toHaveBeenCalled();
});
test("orphan cleanup uses its retained calendar, not the new destination", async () => {
  const h = harness();
  h.pending({ ...receipt, phase: "pending_remove" });
  expect(await reconcileOrganizationCalendar(options, h.deps)).toEqual({
    success: true,
    createdCount: 0,
    updatedCount: 0,
    removedCount: 1,
  });
  expect(h.deps.remove.mock.calls[0].slice(0, 3)).toEqual([
    "fictional",
    "pinned@example.test",
    receipt.event_id,
  ]);
  expect(typeof h.deps.remove.mock.calls[0][3]).toBe("function");
});
test("confirmed missing provider target advances generation before retry", async () => {
  const h = harness();
  h.pending({ ...receipt, phase: "pending_update" });
  h.deps.write.mockResolvedValueOnce("missing");
  expect((await reconcileOrganizationCalendar(options, h.deps)).success).toBe(
    true,
  );
  expect(h.steps).toContain("missing");
  expect(h.deps.write.mock.calls.map((call) => call[0].eventId)).toEqual([
    receipt.event_id,
    "lanew1234",
  ]);
});
test("uncertain delivery preserves the plan and reports incomplete", async () => {
  const h = harness();
  h.deps.write.mockResolvedValue("unconfirmed");
  expect((await reconcileOrganizationCalendar(options, h.deps)).success).toBe(
    false,
  );
  expect(h.steps).toEqual(["plan", "next", "release"]);
});
test("request budget preserves progress and releases the lease", async () => {
  const h = harness();
  let now = 0;
  h.deps.now = () => {
    now += 26000;
    return now;
  };
  expect((await reconcileOrganizationCalendar(options, h.deps)).success).toBe(
    false,
  );
  expect(h.steps).toEqual(["plan", "release"]);
  expect(h.deps.write).not.toHaveBeenCalled();
});
test("revocation during removal ownership lookup stops DELETE and preserves its pending receipt", async () => {
  const h = harness();
  h.pending({ ...receipt, phase: "pending_remove" });
  let deletions = 0;
  h.deps.remove.mockImplementation(
    async (_token, _calendar, _id, beforeWrite) => {
      // The ownership lookup completed, while the actor or lease was revoked.
      h.failRenew();
      try {
        await beforeWrite?.();
      } catch {
        return false;
      }
      deletions++;
      return true;
    },
  );
  expect((await reconcileOrganizationCalendar(options, h.deps)).success).toBe(
    false,
  );
  expect(deletions).toBe(0);
  expect(h.steps).toContain("renew");
  expect(h.steps).not.toContain("complete");
  expect(h.steps).not.toContain("finish");
});
test("an unacknowledged lease renewal stops provider removal", async () => {
  const h = harness();
  h.pending({ ...receipt, phase: "pending_remove" });
  h.renewValue(null);
  let deletions = 0;
  h.deps.remove.mockImplementation(
    async (_token, _calendar, _id, beforeWrite) => {
      try {
        await beforeWrite?.();
      } catch {
        return false;
      }
      deletions++;
      return true;
    },
  );
  expect((await reconcileOrganizationCalendar(options, h.deps)).success).toBe(
    false,
  );
  expect(deletions).toBe(0);
  expect(h.steps).not.toContain("complete");
});
test("a deadline that already passed claims nothing and loads nothing", async () => {
  const h = harness();
  const load = mock(async () => []);
  const expired = new AbortController();
  expired.abort();
  const result = await reconcileOrganizationCalendar(
    { ...options, load, signal: expired.signal },
    h.deps,
  );
  expect(result.success).toBe(false);
  expect(h.deps.rpc).not.toHaveBeenCalled();
  expect(load).not.toHaveBeenCalled();
});
test("a deadline that passes while sources load stops before the plan", async () => {
  const h = harness();
  const controller = new AbortController();
  const result = await reconcileOrganizationCalendar(
    {
      ...options,
      signal: controller.signal,
      load: async () => {
        controller.abort();
        return [];
      },
    },
    h.deps,
  );
  expect(result.success).toBe(false);
  expect(h.steps).toEqual(["release"]);
  expect(h.deps.write).not.toHaveBeenCalled();
});
test.each(["before", "during"] as const)(
  "a deadline that passes %s the lease renewal stops the provider mutation",
  async (moment) => {
    const h = harness();
    const controller = new AbortController();
    const rpc = h.deps.rpc;
    h.deps.rpc = mock(async (name: string, args: Record<string, unknown>) => {
      if (moment === "during" && args.p_step === "renew") controller.abort();
      return rpc(name, args);
    });
    let mutations = 0;
    h.deps.write.mockImplementation(async (request) => {
      if (moment === "before") controller.abort();
      await request.beforeWrite?.();
      mutations++;
      return "confirmed";
    });
    const result = await reconcileOrganizationCalendar(
      { ...options, signal: controller.signal },
      h.deps,
    );
    expect(result.success).toBe(false);
    expect(mutations).toBe(0);
    expect(h.steps.includes("renew")).toBe(moment === "during");
    expect(h.steps).not.toContain("complete");
    expect(h.steps).not.toContain("finish");
    expect(h.steps[h.steps.length - 1]).toBe("release");
  },
);
test("a deadline that passes before a removal's renewal stops the DELETE", async () => {
  const h = harness();
  h.pending({ ...receipt, phase: "pending_remove" });
  const controller = new AbortController();
  let deletions = 0;
  h.deps.remove.mockImplementation(
    async (_token, _calendar, _id, beforeWrite) => {
      controller.abort();
      try {
        await beforeWrite?.();
      } catch {
        return false;
      }
      deletions++;
      return true;
    },
  );
  const result = await reconcileOrganizationCalendar(
    { ...options, signal: controller.signal },
    h.deps,
  );
  expect(result.success).toBe(false);
  expect(deletions).toBe(0);
  expect(h.steps).not.toContain("renew");
  expect(h.steps).not.toContain("complete");
});
test("a write confirmed as the deadline passes is recorded, and nothing else starts", async () => {
  const h = harness();
  const controller = new AbortController();
  h.deps.write.mockImplementation(async (request) => {
    await request.beforeWrite?.();
    // The request was already sent. Stopping does not take it back.
    controller.abort();
    return "confirmed";
  });
  const result = await reconcileOrganizationCalendar(
    { ...options, signal: controller.signal },
    h.deps,
  );
  expect(result.success).toBe(false);
  expect(h.steps).toEqual(["plan", "next", "renew", "complete", "release"]);
  expect(h.deps.write).toHaveBeenCalledTimes(1);
});
test("an unacknowledged renewal also stops same-ID provider updates", async () => {
  const h = harness();
  h.pending({ ...receipt, phase: "pending_update" });
  h.renewValue(null);
  let mutations = 0;
  h.deps.write.mockImplementation(async (request) => {
    await request.beforeWrite?.();
    mutations++;
    return "confirmed";
  });
  expect((await reconcileOrganizationCalendar(options, h.deps)).success).toBe(
    false,
  );
  expect(mutations).toBe(0);
  expect(h.steps).not.toContain("complete");
  expect(h.deps.write.mock.calls[0][0].eventId).toBe(receipt.event_id);
});
