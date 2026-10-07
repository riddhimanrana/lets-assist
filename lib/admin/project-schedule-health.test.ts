import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  parseProjectScheduleHealth,
  scheduleMaintenanceState,
} from "./project-schedule-health";

const fixture = {
  invalid_count: 0,
  projects: [],
  last_run: {
    invalid_count: 0,
    fingerprint: "a".repeat(32),
    checked_at: "2026-10-07T12:00:00+00:00",
    changed_at: "2026-10-07T11:00:00+00:00",
  },
};
const project = {
  id: "fc910000-0000-4000-8000-000000000001",
  title: "Synthetic project",
  event_type: "oneTime",
  organization_id: null,
};

describe("project schedule health", () => {
  test("distinguishes no run and stale worker from an empty backlog", () => {
    expect(scheduleMaintenanceState({ ...fixture, last_run: null })).toBe(
      "no_run",
    );
    expect(
      scheduleMaintenanceState(fixture, Date.parse("2026-10-07T12:16:00Z")),
    ).toBe("stale");
    expect(
      scheduleMaintenanceState(fixture, Date.parse("2026-10-07T12:01:00Z")),
    ).toBe("current");
  });
  test("shows live corrections even when the last observation was clear", () => {
    expect(
      scheduleMaintenanceState(
        { ...fixture, invalid_count: 1, projects: [project] },
        Date.parse("2026-10-07T12:01:00Z"),
      ),
    ).toBe("needs_correction");
  });
  test("validates bounded projections without guessing malformed counts", () => {
    expect(parseProjectScheduleHealth(fixture).data).toEqual(fixture);
    for (const invalid of [
      null,
      {},
      { ...fixture, invalid_count: -1 },
      { ...fixture, invalid_count: "0" },
      { ...fixture, projects: [project] },
      { ...fixture, last_run: { ...fixture.last_run, checked_at: "never" } },
      { ...fixture, invalid_count: 2, projects: [project, project] },
    ]) {
      expect(parseProjectScheduleHealth(invalid).error).toBeDefined();
    }
  });
  test("accepts a bounded first page with a larger exact count", () => {
    const value = { ...fixture, invalid_count: 1001, projects: [project] };
    expect(parseProjectScheduleHealth(value).data).toEqual(value);
  });
});

test("the server action derives the actor and refuses unavailable projections", () => {
  const script = `
    import { mock } from "bun:test";
    import assert from "node:assert/strict";
    let authorized = false, unavailable = false, calls = 0;
    mock.module("server-only", () => ({}));
    mock.module("./app/admin/server/auth", () => ({ checkSuperAdmin: async () => ({ isAdmin: authorized, userId: "session-admin" }) }));
    mock.module("./lib/supabase/admin", () => ({ getAdminClient: () => ({ rpc: async (name, args) => {
      calls++; assert.equal(name, "get_project_schedule_health");
      assert.deepEqual(args, { p_actor_id: "session-admin", p_limit: 25 });
      return unavailable ? { error: { message: "synthetic private provider detail" } } : { data: { invalid_count: 0, projects: [], last_run: null } };
    } }) }));
    const { getProjectScheduleHealth } = await import("./app/admin/server/project-schedule-health");
    assert.ok((await getProjectScheduleHealth()).error); assert.equal(calls, 0);
    authorized = true;
    assert.equal((await getProjectScheduleHealth()).data.last_run, null);
    unavailable = true;
    const result = await getProjectScheduleHealth();
    assert.ok(result.error); assert.equal(result.data, undefined);
    assert.equal(JSON.stringify(result).includes("private provider detail"), false);
  `;
  const result = spawnSync(process.execPath, ["--eval", script], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});
