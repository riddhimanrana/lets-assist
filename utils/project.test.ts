import { describe, expect, it } from "vitest";

import type { Project } from "@/types";
import {
  getMultiDaySlotByScheduleId,
  getMultiDaySlotDisplayName,
  getSlotDetails,
  parseMultiDayScheduleId,
} from "@/utils/project";

const multiDayProject = {
  id: "project-1",
  title: "Community Fair",
  description: "Help with a multi-day community fair.",
  location: "Town Square",
  event_type: "multiDay",
  verification_method: "qr-code",
  require_login: true,
  creator_id: "user-1",
  schedule: {
    multiDay: [
      {
        date: "2026-03-07",
        slots: [
          {
            name: "Morning Setup",
            startTime: "09:00",
            endTime: "11:00",
            volunteers: 5,
          },
          {
            startTime: "12:00",
            endTime: "14:00",
            volunteers: 3,
          },
        ],
      },
    ],
  },
  status: "upcoming",
  visibility: "unlisted",
  pause_signups: false,
  profiles: {} as Project["profiles"],
  created_at: "2026-03-01T12:00:00.000Z",
} as Project;

describe("multi-day schedule helpers", () => {
  it("parses multi-day schedule IDs using the last dash", () => {
    expect(parseMultiDayScheduleId("2026-03-07-1")).toEqual({
      date: "2026-03-07",
      slotIndex: 1,
    });
  });

  it("returns custom slot names when provided and falls back otherwise", () => {
    expect(
      getMultiDaySlotDisplayName(
        { name: "Morning Setup", startTime: "09:00", endTime: "11:00" },
        0,
      ),
    ).toBe("Morning Setup");

    expect(
      getMultiDaySlotDisplayName(
        { name: "", startTime: "12:00", endTime: "14:00" },
        1,
      ),
    ).toBe("Slot 2");
  });

  it("resolves multi-day slots by schedule ID", () => {
    const slotData = getMultiDaySlotByScheduleId(multiDayProject, "2026-03-07-0");

    expect(slotData).not.toBeNull();
    expect(slotData?.day.date).toBe("2026-03-07");
    expect(slotData?.slotIndex).toBe(0);
    expect(slotData?.slot.name).toBe("Morning Setup");
  });

  it("returns the stored slot object from getSlotDetails", () => {
    expect(getSlotDetails(multiDayProject, "2026-03-07-0")).toMatchObject({
      name: "Morning Setup",
      startTime: "09:00",
      endTime: "11:00",
    });
  });
});