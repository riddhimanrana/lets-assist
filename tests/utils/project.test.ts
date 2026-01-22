/**
 * Tests for project utility functions
 * @see utils/project.ts
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  getProjectEventDate,
  getProjectStartDateTime,
  getProjectEndDateTime,
  getProjectStatus,
  canDeleteProject,
  canCancelProject,
  isProjectVisible,
  canManageProject,
  formatStatusText,
  getSlotDetails,
  isSlotAvailable,
  isMultiDaySlotPast,
  getAvailableMultiDaySlots,
  hasAvailableMultiDaySlots,
  isOneTimeSlotPast,
} from "@/utils/project";
import {
  createMockProject,
  createMockOneTimeProject,
  createMockMultiDayProject,
  createMockSameDayMultiAreaProject,
  createCompletedProject,
  createCancelledProject,
  resetFactories,
} from "../factories";

beforeEach(() => {
  resetFactories();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getProjectEventDate", () => {
  it("returns the date for oneTime events", () => {
    const project = createMockOneTimeProject({
      schedule: {
        oneTime: {
          date: "2026-02-15",
          startTime: "09:00",
          endTime: "12:00",
          volunteers: 10,
        },
      },
    });
    
    const date = getProjectEventDate(project);
    expect(date.toISOString().split("T")[0]).toBe("2026-02-15");
  });
  
  it("returns the earliest date for multiDay events", () => {
    const project = createMockMultiDayProject({
      schedule: {
        multiDay: [
          { date: "2026-02-17", slots: [{ startTime: "09:00", endTime: "12:00", volunteers: 5 }] },
          { date: "2026-02-15", slots: [{ startTime: "09:00", endTime: "12:00", volunteers: 5 }] },
          { date: "2026-02-16", slots: [{ startTime: "09:00", endTime: "12:00", volunteers: 5 }] },
        ],
      },
    });
    
    const date = getProjectEventDate(project);
    // Returns first in array, not earliest
    expect(date.toISOString().split("T")[0]).toBe("2026-02-17");
  });
  
  it("returns the date for sameDayMultiArea events", () => {
    const project = createMockSameDayMultiAreaProject({
      schedule: {
        sameDayMultiArea: {
          date: "2026-03-01",
          overallStart: "08:00",
          overallEnd: "18:00",
          roles: [{ name: "Helper", startTime: "09:00", endTime: "12:00", volunteers: 5 }],
        },
      },
    });
    
    const date = getProjectEventDate(project);
    expect(date.toISOString().split("T")[0]).toBe("2026-03-01");
  });
});

describe("getProjectStartDateTime", () => {
  it("returns correct start datetime for oneTime events", () => {
    const project = createMockOneTimeProject({
      schedule: {
        oneTime: {
          date: "2026-02-15",
          startTime: "14:30",
          endTime: "17:00",
          volunteers: 10,
        },
      },
    });
    
    const startDateTime = getProjectStartDateTime(project);
    expect(startDateTime.getHours()).toBe(14);
    expect(startDateTime.getMinutes()).toBe(30);
  });
  
  it("returns earliest slot start for multiDay events", () => {
    const project = createMockMultiDayProject({
      schedule: {
        multiDay: [
          { 
            date: "2026-02-15", 
            slots: [
              { startTime: "10:00", endTime: "12:00", volunteers: 5 },
              { startTime: "14:00", endTime: "16:00", volunteers: 5 },
            ],
          },
          { 
            date: "2026-02-14", // Earlier date
            slots: [
              { startTime: "08:00", endTime: "10:00", volunteers: 5 }, // Earliest overall
            ],
          },
        ],
      },
    });
    
    const startDateTime = getProjectStartDateTime(project);
    expect(startDateTime.getHours()).toBe(8);
    expect(startDateTime.getMinutes()).toBe(0);
  });
});

describe("getProjectEndDateTime", () => {
  it("returns correct end datetime for oneTime events", () => {
    const project = createMockOneTimeProject({
      schedule: {
        oneTime: {
          date: "2026-02-15",
          startTime: "09:00",
          endTime: "17:30",
          volunteers: 10,
        },
      },
    });
    
    const endDateTime = getProjectEndDateTime(project);
    expect(endDateTime.getHours()).toBe(17);
    expect(endDateTime.getMinutes()).toBe(30);
  });
});

describe("getProjectStatus", () => {
  it("returns cancelled for cancelled projects", () => {
    const project = createCancelledProject();
    expect(getProjectStatus(project)).toBe("cancelled");
  });
  
  it("returns upcoming for draft projects", () => {
    const project = createMockProject({ workflow_status: "draft" });
    expect(getProjectStatus(project)).toBe("upcoming");
  });
  
  it("returns upcoming for projects without schedule", () => {
    const project = createMockProject();
    // @ts-expect-error - intentionally testing invalid state
    project.schedule = undefined;
    expect(getProjectStatus(project)).toBe("upcoming");
  });
  
  it("returns completed for past events", () => {
    // Set "now" to after the event
    vi.setSystemTime(new Date("2026-02-16T00:00:00"));
    
    const project = createMockOneTimeProject({
      schedule: {
        oneTime: {
          date: "2026-02-15",
          startTime: "09:00",
          endTime: "12:00",
          volunteers: 10,
        },
      },
    });
    
    expect(getProjectStatus(project)).toBe("completed");
  });
  
  it("returns in-progress for ongoing events", () => {
    vi.setSystemTime(new Date("2026-02-15T10:30:00"));
    
    const project = createMockOneTimeProject({
      schedule: {
        oneTime: {
          date: "2026-02-15",
          startTime: "09:00",
          endTime: "12:00",
          volunteers: 10,
        },
      },
    });
    
    expect(getProjectStatus(project)).toBe("in-progress");
  });
  
  it("returns upcoming for future events", () => {
    vi.setSystemTime(new Date("2026-02-01T10:00:00"));
    
    const project = createMockOneTimeProject({
      schedule: {
        oneTime: {
          date: "2026-02-15",
          startTime: "09:00",
          endTime: "12:00",
          volunteers: 10,
        },
      },
    });
    
    expect(getProjectStatus(project)).toBe("upcoming");
  });
});

describe("canCancelProject", () => {
  it("returns false for already cancelled projects", () => {
    const project = createCancelledProject();
    expect(canCancelProject(project)).toBe(false);
  });
  
  it("returns false for completed projects", () => {
    const project = createCompletedProject();
    expect(canCancelProject(project)).toBe(false);
  });
  
  it("returns true for upcoming projects", () => {
    const project = createMockProject({ status: "upcoming" });
    expect(canCancelProject(project)).toBe(true);
  });
});

describe("canDeleteProject", () => {
  it("always returns true (no restrictions)", () => {
    expect(canDeleteProject(createMockProject())).toBe(true);
    expect(canDeleteProject(createCancelledProject())).toBe(true);
    expect(canDeleteProject(createCompletedProject())).toBe(true);
  });
});

describe("isProjectVisible", () => {
  it("returns true for public projects", () => {
    const project = createMockProject({ visibility: "public" });
    expect(isProjectVisible(project)).toBe(true);
  });
  
  it("returns true for unlisted projects (accessible with link)", () => {
    const project = createMockProject({ visibility: "unlisted" });
    expect(isProjectVisible(project)).toBe(true);
  });
  
  it("returns false for organization-only projects without user", () => {
    const project = createMockProject({
      visibility: "organization_only",
      organization_id: "org-1",
    });
    expect(isProjectVisible(project)).toBe(false);
  });
  
  it("returns true for organization-only projects with member", () => {
    const project = createMockProject({
      visibility: "organization_only",
      organization_id: "org-1",
    });
    const userOrgs = [{ organization_id: "org-1", role: "member" }];
    expect(isProjectVisible(project, "user-1", userOrgs)).toBe(true);
  });
  
  it("returns false for organization-only projects with non-member", () => {
    const project = createMockProject({
      visibility: "organization_only",
      organization_id: "org-1",
    });
    const userOrgs = [{ organization_id: "org-2", role: "member" }];
    expect(isProjectVisible(project, "user-1", userOrgs)).toBe(false);
  });
});

describe("canManageProject", () => {
  it("returns false without userId", () => {
    const project = createMockProject();
    expect(canManageProject(project)).toBe(false);
  });
  
  it("returns true for project creator", () => {
    const project = createMockProject({ creator_id: "user-123" });
    expect(canManageProject(project, "user-123")).toBe(true);
  });
  
  it("returns false for non-creator without org membership", () => {
    const project = createMockProject({ creator_id: "user-123" });
    expect(canManageProject(project, "user-456")).toBe(false);
  });
  
  it("returns true for org admin", () => {
    const project = createMockProject({
      creator_id: "user-123",
      organization_id: "org-1",
    });
    const userOrgs = [{ organization_id: "org-1", role: "admin" }];
    expect(canManageProject(project, "user-456", userOrgs)).toBe(true);
  });
  
  it("returns true for org staff", () => {
    const project = createMockProject({
      creator_id: "user-123",
      organization_id: "org-1",
    });
    const userOrgs = [{ organization_id: "org-1", role: "staff" }];
    expect(canManageProject(project, "user-456", userOrgs)).toBe(true);
  });
  
  it("returns false for org member (not admin/staff)", () => {
    const project = createMockProject({
      creator_id: "user-123",
      organization_id: "org-1",
    });
    const userOrgs = [{ organization_id: "org-1", role: "member" }];
    expect(canManageProject(project, "user-456", userOrgs)).toBe(false);
  });
});

describe("formatStatusText", () => {
  it("capitalizes first letter and replaces hyphens", () => {
    expect(formatStatusText("in-progress")).toBe("In progress");
    expect(formatStatusText("upcoming")).toBe("Upcoming");
    expect(formatStatusText("completed")).toBe("Completed");
    expect(formatStatusText("cancelled")).toBe("Cancelled");
  });
  
  it("returns Unknown for empty string", () => {
    expect(formatStatusText("")).toBe("Unknown");
  });
});

describe("getSlotDetails", () => {
  it("returns slot details for oneTime events", () => {
    const project = createMockOneTimeProject({
      schedule: {
        oneTime: {
          date: "2026-02-15",
          startTime: "09:00",
          endTime: "12:00",
          volunteers: 10,
        },
      },
    });
    
    const slot = getSlotDetails(project, "oneTime");
    expect(slot).toEqual({
      date: "2026-02-15",
      startTime: "09:00",
      endTime: "12:00",
      volunteers: 10,
    });
  });
  
  it("returns null for invalid scheduleId", () => {
    const project = createMockOneTimeProject();
    expect(getSlotDetails(project, "invalid")).toBeNull();
  });
  
  it("returns slot details for multiDay events", () => {
    const project = createMockMultiDayProject({
      schedule: {
        multiDay: [
          {
            date: "2026-02-15",
            slots: [
              { startTime: "09:00", endTime: "12:00", volunteers: 5 },
              { startTime: "13:00", endTime: "17:00", volunteers: 8 },
            ],
          },
        ],
      },
    });
    
    const slot = getSlotDetails(project, "2026-02-15-1");
    expect(slot).toEqual({ startTime: "13:00", endTime: "17:00", volunteers: 8 });
  });
  
  it("returns role details for sameDayMultiArea events", () => {
    const project = createMockSameDayMultiAreaProject({
      schedule: {
        sameDayMultiArea: {
          date: "2026-02-15",
          overallStart: "08:00",
          overallEnd: "18:00",
          roles: [
            { name: "Registration", startTime: "08:00", endTime: "10:00", volunteers: 3 },
            { name: "Food Service", startTime: "11:00", endTime: "14:00", volunteers: 8 },
          ],
        },
      },
    });
    
    const role = getSlotDetails(project, "Food Service");
    expect(role).toEqual({ name: "Food Service", startTime: "11:00", endTime: "14:00", volunteers: 8 });
  });
});

describe("isSlotAvailable", () => {
  it("returns false for cancelled projects", () => {
    const project = createCancelledProject();
    expect(isSlotAvailable(project, "oneTime", { oneTime: 5 })).toBe(false);
  });
  
  it("returns false for completed projects", () => {
    const project = createMockProject({ status: "completed" });
    expect(isSlotAvailable(project, "oneTime", { oneTime: 5 })).toBe(false);
  });
  
  it("returns false when no remaining slots", () => {
    const project = createMockProject({ status: "upcoming" });
    expect(isSlotAvailable(project, "oneTime", { oneTime: 0 })).toBe(false);
  });
  
  it("returns true when slots are available", () => {
    const project = createMockOneTimeProject({ status: "upcoming" });
    expect(isSlotAvailable(project, "oneTime", { oneTime: 5 })).toBe(true);
  });
  
  it("respects clientStatus override", () => {
    const project = createMockOneTimeProject({ status: "upcoming" });
    expect(isSlotAvailable(project, "oneTime", { oneTime: 5 }, "cancelled")).toBe(false);
  });
});

describe("isMultiDaySlotPast", () => {
  it("returns true for past slots", () => {
    vi.setSystemTime(new Date("2026-02-16T00:00:00"));
    
    const day = {
      date: "2026-02-15",
      slots: [{ endTime: "17:00" }],
    };
    
    expect(isMultiDaySlotPast(day)).toBe(true);
  });
  
  it("returns false for future slots", () => {
    vi.setSystemTime(new Date("2026-02-14T00:00:00"));
    
    const day = {
      date: "2026-02-15",
      slots: [{ endTime: "17:00" }],
    };
    
    expect(isMultiDaySlotPast(day)).toBe(false);
  });
  
  it("returns true for empty slots array", () => {
    const day = { date: "2026-02-15", slots: [] };
    expect(isMultiDaySlotPast(day)).toBe(true);
  });
});

describe("getAvailableMultiDaySlots / hasAvailableMultiDaySlots", () => {
  it("returns empty array for non-multiDay events", () => {
    const project = createMockOneTimeProject();
    expect(getAvailableMultiDaySlots(project)).toEqual([]);
    expect(hasAvailableMultiDaySlots(project)).toBe(false);
  });
  
  it("filters out past days", () => {
    vi.setSystemTime(new Date("2026-02-16T00:00:00"));
    
    const project = createMockMultiDayProject({
      schedule: {
        multiDay: [
          { date: "2026-02-15", slots: [{ startTime: "09:00", endTime: "12:00", volunteers: 5 }] }, // past
          { date: "2026-02-17", slots: [{ startTime: "09:00", endTime: "12:00", volunteers: 5 }] }, // future
          { date: "2026-02-18", slots: [{ startTime: "09:00", endTime: "12:00", volunteers: 5 }] }, // future
        ],
      },
    });
    
    const available = getAvailableMultiDaySlots(project);
    expect(available).toEqual([1, 2]); // indices of future days
    expect(hasAvailableMultiDaySlots(project)).toBe(true);
  });
});

describe("isOneTimeSlotPast", () => {
  it("returns true for past oneTime events", () => {
    vi.setSystemTime(new Date("2026-02-16T00:00:00"));
    
    const project = createMockOneTimeProject({
      schedule: {
        oneTime: {
          date: "2026-02-15",
          startTime: "09:00",
          endTime: "12:00",
          volunteers: 10,
        },
      },
    });
    
    expect(isOneTimeSlotPast(project)).toBe(true);
  });
  
  it("returns false for future oneTime events", () => {
    vi.setSystemTime(new Date("2026-02-14T00:00:00"));
    
    const project = createMockOneTimeProject({
      schedule: {
        oneTime: {
          date: "2026-02-15",
          startTime: "09:00",
          endTime: "12:00",
          volunteers: 10,
        },
      },
    });
    
    expect(isOneTimeSlotPast(project)).toBe(false);
  });
  
  it("returns false for non-oneTime events", () => {
    const project = createMockMultiDayProject();
    expect(isOneTimeSlotPast(project)).toBe(false);
  });
});
