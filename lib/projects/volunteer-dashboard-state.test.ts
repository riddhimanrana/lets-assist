import { describe, expect, it } from "vitest";

import {
  buildVolunteerDashboardSlotState,
  VOLUNTEER_DASHBOARD_SIGNUP_STATUSES,
} from "./volunteer-dashboard-state";

describe("volunteer dashboard slot state", () => {
  it("includes pending signups in the dashboard status allowlist", () => {
    expect(VOLUNTEER_DASHBOARD_SIGNUP_STATUSES).toEqual([
      "approved",
      "attended",
      "pending",
    ]);
  });

  it("marks pending signups as occupied slots for button state", () => {
    const { userSignups, attendedSlots, pendingSlots } = buildVolunteerDashboardSlotState([
      {
        id: "signup-1",
        schedule_id: "oneTime",
        status: "pending",
        check_in_time: null,
        check_out_time: null,
        created_at: new Date().toISOString(),
      },
    ]);

    expect(userSignups).toEqual({ oneTime: true });
    expect(attendedSlots).toEqual({});
    expect(pendingSlots).toEqual({ oneTime: true });
  });

  it("keeps attended slots flagged separately from general signup occupancy", () => {
    const { userSignups, attendedSlots, pendingSlots } = buildVolunteerDashboardSlotState([
      {
        id: "signup-1",
        schedule_id: "slot-a",
        status: "approved",
        check_in_time: null,
        check_out_time: null,
        created_at: new Date().toISOString(),
      },
      {
        id: "signup-2",
        schedule_id: "slot-b",
        status: "attended",
        check_in_time: new Date().toISOString(),
        check_out_time: null,
        created_at: new Date().toISOString(),
      },
    ]);

    expect(userSignups).toEqual({
      "slot-a": true,
      "slot-b": true,
    });
    expect(attendedSlots).toEqual({
      "slot-b": true,
    });
    expect(pendingSlots).toEqual({});
  });
});