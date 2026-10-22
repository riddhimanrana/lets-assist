import { beforeEach, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const owner = "10000000-0000-4000-8000-000000000001";
const project = "10000000-0000-4000-8000-000000000002";
const token = "10000000-0000-4000-8000-000000000003";
const generation = "10000000-0000-4000-8000-000000000004";
const input = {
  userId: owner,
  projectId: project,
  expectedEventId: "event001",
};
function receipt() {
  return {
    source_kind: "project",
    source_id: project,
    project_id: project,
    user_id: owner,
    generation,
    phase: "removing",
    requested_schedule_id: null,
    legacy_event_id: "event001",
    calendar_id: null,
    events: [],
    confirmed_event_ids: [],
    claim_token: token,
  };
}
let claimed: Record<string, unknown>;
let released: Record<string, unknown>;
let failedRpc: string | null;
const calls: Array<{ name: string; args: unknown }> = [];
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return {
        data: name === "claim_personal_calendar_sync" ? claimed : released,
        error: name === failedRpc ? { code: "synthetic" } : null,
      };
    },
  }),
}));
const { retainProjectCalendarCleanup } =
  await import("./retain-project-cleanup");
beforeEach(() => {
  claimed = receipt();
  released = { ...receipt(), claim_token: null };
  failedRpc = null;
  calls.length = 0;
});

test("retains the exact creator-owned legacy receipt without provider work", async () => {
  await retainProjectCalendarCleanup(input);
  expect(calls).toEqual([
    {
      name: "claim_personal_calendar_sync",
      args: {
        p_actor_user_id: owner,
        p_source_kind: "project",
        p_source_id: project,
        p_operation: "remove",
        p_schedule_id: null,
        p_expected_event_id: "event001",
      },
    },
    {
      name: "advance_personal_calendar_sync",
      args: {
        p_actor_user_id: owner,
        p_source_kind: "project",
        p_source_id: project,
        p_claim_token: token,
        p_step: "release",
        p_payload: {},
      },
    },
  ]);
});

test("an already removed receipt needs no new provider or release attempt", async () => {
  claimed = { ...receipt(), phase: "removed", claim_token: null };
  await retainProjectCalendarCleanup(input);
  expect(calls).toHaveLength(1);
});

test("retains a complete multi-event plan and its confirmed progress", async () => {
  const plan = {
    legacy_event_id: null,
    calendar_id: "owned@example.test",
    events: [
      { id: "event001", event: null },
      { id: "event002", event: null },
    ],
    confirmed_event_ids: ["event001"],
  };
  claimed = { ...claimed, ...plan };
  released = { ...released, ...plan };
  await retainProjectCalendarCleanup(input);
  expect(calls).toHaveLength(2);
});

test.each(["claim_personal_calendar_sync", "advance_personal_calendar_sync"])(
  "an unconfirmed %s stops deletion",
  async (name) => {
    failedRpc = name;
    await expect(retainProjectCalendarCleanup(input)).rejects.toThrow(
      "not retained",
    );
    expect(calls).toHaveLength(name === "claim_personal_calendar_sync" ? 1 : 2);
  },
);

test.each([
  ["source_kind", "signup"],
  ["source_id", owner],
  ["project_id", owner],
  ["user_id", project],
  ["legacy_event_id", "event999"],
  ["phase", "synced"],
  ["claim_token", null],
])("a claim with changed %s is refused before release", async (key, value) => {
  claimed = { ...claimed, [key as string]: value };
  await expect(retainProjectCalendarCleanup(input)).rejects.toThrow(
    "not retained",
  );
  expect(calls).toHaveLength(1);
});

test.each([
  ["generation", owner],
  ["phase", "removed"],
  ["claim_token", token],
  ["calendar_id", "other@example.test"],
  ["events", [{ id: "event001", event: null }]],
  ["confirmed_event_ids", ["event001"]],
])(
  "an unconfirmed release with changed %s stops deletion",
  async (key, value) => {
    released = { ...released, [key as string]: value };
    await expect(retainProjectCalendarCleanup(input)).rejects.toThrow(
      "not retained",
    );
  },
);
