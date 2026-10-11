import assert from "node:assert/strict";
import { mock } from "bun:test";
import * as React from "react";
import type { Project } from "@/types";
import type { SlotAttendee } from "@/components/projects/SlotAttendeesDropdown";

const scenario = process.argv[2];
const state: unknown[] = [];
let cursor = 0;
let effect: (() => (() => void) | void) | undefined;
mock.module("react", () => ({
  ...React,
  useState: (initial: unknown) => {
    const i = cursor++;
    if (!(i in state)) state[i] = initial;
    return [
      state[i],
      (value: unknown) => {
        state[i] = value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const i = cursor++;
    if (!(i in state)) state[i] = { current: initial };
    return state[i];
  },
  useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(),
  useEffect: (fn: typeof effect) => {
    effect = fn;
  },
}));

let calls = 0;
let fail = scenario === "error-retry";
const attendees = [
  { signup_id: "own", schedule_id: "2030-03-14-0-0" },
  { signup_id: "guest", schedule_id: "2030-03-14-0", is_anonymous: true },
  { signup_id: "removed", schedule_id: "2030-03-07-0-0" },
] as SlotAttendee[];
mock.module("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: async (name: string, args: unknown) => {
      assert.equal(name, "get_public_attendees");
      assert.deepEqual(args, { p_project_id: "fictional-project" });
      calls++;
      return {
        data: fail ? null : attendees,
        error: fail ? { message: "Fictional failure" } : null,
      };
    },
  }),
}));
mock.module("@/lib/safe-console", () => ({ safeConsole: { error() {} } }));
const { usePublicAttendees } = await import("./usePublicAttendees");
const privateRoster = scenario === "restricted" || scenario === "manager";
const project = {
  id: "fictional-project",
  status: "completed",
  workflow_status: "archived",
  event_type: "multiDay",
  visibility: privateRoster ? "organization_only" : "unlisted",
  show_attendees_publicly: !privateRoster,
  schedule: { multiDay: [{ date: "2030-03-14", slots: [{}] }] },
} as Project;
const render = () => {
  cursor = 0;
  return usePublicAttendees({
    project,
    canManageProject: scenario === "manager",
    demoMode: false,
    demoPublicAttendees: [],
  });
};
let result = render();
assert.equal(result.rosterState, "loading");
const cleanup = effect?.();
if (scenario === "stale") cleanup?.();
await new Promise((resolve) => setTimeout(resolve, 0));
result = render();
if (scenario === "restricted") {
  assert.equal(calls, 0);
  assert.equal(result.rosterState, "restricted");
  assert.deepEqual(result.getAttendeesForSlot("2030-03-14-0-0"), []);
} else if (scenario === "stale") {
  assert.equal(calls, 1);
  assert.equal(result.rosterState, "loading");
  assert.deepEqual(result.previousScheduleAttendees, []);
} else {
  if (scenario === "error-retry") {
    assert.equal(result.rosterState, "error");
    assert.deepEqual(result.previousScheduleAttendees, []);
    fail = false;
    await result.refetchAttendees();
    result = render();
    assert.equal(calls, 2);
  }
  assert.equal(result.rosterState, "ready");
  assert.deepEqual(
    result.getAttendeesForSlot("2030-03-14-0-0").map((row) => row.signup_id),
    ["own", "guest"],
  );
  assert.deepEqual(
    result.previousScheduleAttendees.map((row) => row.signup_id),
    ["removed"],
  );
}
