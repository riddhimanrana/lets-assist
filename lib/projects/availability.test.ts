import { describe, expect, it } from "vitest";

import {
  buildProjectOccupancyByProject,
  getProjectFilledSpots,
  getProjectRemainingSpots,
  getProjectVolunteerCapacity,
  summarizeProjectOccupancy,
  type ProjectAvailability,
  type ProjectSignupOccupancyRow,
} from "./availability";

const oneTimeProject = {
  event_type: "oneTime",
  schedule: {
    oneTime: {
      volunteers: 40,
    },
  },
} as ProjectAvailability;

describe("project availability helpers", () => {
  it("summarizes only active signups for occupancy", () => {
    const summary = summarizeProjectOccupancy([
      { project_id: "project-1", schedule_id: "slot-1", status: "approved" },
      { project_id: "project-1", schedule_id: "slot-1", status: "pending" },
      { project_id: "project-1", schedule_id: "slot-2", status: "attended" },
      { project_id: "project-1", schedule_id: "slot-2", status: "rejected" },
    ] satisfies ProjectSignupOccupancyRow[]);

    expect(summary).toEqual({
      slotsFilled: 3,
      slotsFilledBySchedule: {
        "slot-1": 2,
        "slot-2": 1,
      },
    });
  });

  it("builds per-project occupancy maps", () => {
    const occupancy = buildProjectOccupancyByProject([
      { project_id: "project-1", schedule_id: "slot-1", status: "approved" },
      { project_id: "project-1", schedule_id: "slot-2", status: "pending" },
      { project_id: "project-2", schedule_id: "slot-a", status: "attended" },
      { project_id: "project-2", schedule_id: "slot-b", status: "rejected" },
    ] satisfies ProjectSignupOccupancyRow[]);

    expect(occupancy).toEqual({
      "project-1": {
        slotsFilled: 2,
        slotsFilledBySchedule: {
          "slot-1": 1,
          "slot-2": 1,
        },
      },
      "project-2": {
        slotsFilled: 1,
        slotsFilledBySchedule: {
          "slot-a": 1,
        },
      },
    });
  });

  it("calculates volunteer capacity across event types", () => {
    const multiDayProject = {
      event_type: "multiDay",
      schedule: {
        multiDay: [
          {
            date: "2026-03-07",
            slots: [{ volunteers: 5 }, { volunteers: 3 }],
          },
          {
            date: "2026-03-08",
            slots: [{ volunteers: 2 }],
          },
        ],
      },
    } as ProjectAvailability;

    const multiAreaProject = {
      event_type: "sameDayMultiArea",
      schedule: {
        sameDayMultiArea: {
          roles: [{ volunteers: 7 }, { volunteers: 4 }],
        },
      },
    } as ProjectAvailability;

    expect(getProjectVolunteerCapacity(oneTimeProject)).toBe(40);
    expect(getProjectVolunteerCapacity(multiDayProject)).toBe(10);
    expect(getProjectVolunteerCapacity(multiAreaProject)).toBe(11);
  });

  it("prefers explicit slots_filled counts and preserves zero", () => {
    const project = {
      ...oneTimeProject,
      slots_filled: 0,
      total_confirmed: 12,
      registrations: [1, 2, 3],
    } as ProjectAvailability;

    expect(getProjectFilledSpots(project)).toBe(0);
    expect(getProjectRemainingSpots(project)).toBe(40);
  });

  it("derives remaining spots from signups when detailed rows are present", () => {
    const project = {
      ...oneTimeProject,
      signups: [
        { status: "approved" },
        { status: "pending" },
        { status: "attended" },
        { status: "rejected" },
      ],
    } as ProjectAvailability;

    expect(getProjectFilledSpots(project)).toBe(3);
    expect(getProjectRemainingSpots(project)).toBe(37);
  });
});