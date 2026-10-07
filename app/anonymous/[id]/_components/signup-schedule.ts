import { format, addDays, parseISO } from "date-fns";
import { formatTimeTo12Hour } from "@/lib/utils";
import { Project } from "@/types";
import {
  getMultiDaySlotByScheduleId,
  getMultiDaySlotDisplayName,
} from "@/utils/project";

// Slot data from the server
export interface SlotData {
  project_signup_id: string;
  status: string;
  schedule_id: string;
  check_in_time: string | null;
  check_out_time: string | null;
}

// Helper function to format schedule slot
export const formatScheduleSlot = (project: Project, slotId: string) => {
  if (!project) return slotId;

  const buildTimeDisplay = (
    time: { date: string; startTime?: string; endTime?: string | null },
    roleLabel?: string,
  ) => {
    const { date, startTime, endTime } = time;
    if (!date) return roleLabel ? roleLabel : "Schedule TBD";

    const parsedDate = parseISO(date);
    const dateLabel = format(parsedDate, "MMMM d, yyyy");

    if (startTime && endTime) {
      const startLabel = formatTimeTo12Hour(startTime);
      const endLabel = formatTimeTo12Hour(endTime);
      const range = `${startLabel} - ${endLabel}`;
      return roleLabel
        ? `${dateLabel} - ${roleLabel} (${range})`
        : `${dateLabel} from ${range}`;
    }

    if (startTime) {
      const startLabel = formatTimeTo12Hour(startTime);
      return roleLabel
        ? `${dateLabel} - ${roleLabel} (${startLabel})`
        : `${dateLabel} starting ${startLabel}`;
    }

    if (endTime) {
      const endLabel = formatTimeTo12Hour(endTime);
      return roleLabel
        ? `${dateLabel} - ${roleLabel} (${endLabel})`
        : `${dateLabel} ending ${endLabel}`;
    }

    return roleLabel ? `${dateLabel} - ${roleLabel}` : dateLabel;
  };

  if (
    project.event_type === "oneTime" &&
    slotId === "oneTime" &&
    project.schedule.oneTime
  ) {
    return buildTimeDisplay(project.schedule.oneTime);
  }

  if (project.event_type === "multiDay") {
    const slotData = getMultiDaySlotByScheduleId(project, slotId);
    if (slotData) {
      const { day, slot, slotIndex } = slotData;
      return buildTimeDisplay(
        { date: day.date, startTime: slot.startTime, endTime: slot.endTime },
        getMultiDaySlotDisplayName(slot, slotIndex),
      );
    }
  }

  if (project.event_type === "sameDayMultiArea") {
    const role = project.schedule.sameDayMultiArea?.roles.find(
      (r) => r.name === slotId,
    );
    if (role) {
      const eventDate = project.schedule.sameDayMultiArea?.date;
      return buildTimeDisplay(
        {
          date: eventDate || new Date().toISOString().split("T")[0],
          startTime: role.startTime,
          endTime: role.endTime,
        },
        role.name,
      );
    }
  }

  return slotId;
};

// Calculate project end date
const getProjectEndDate = (project: Project): Date | null => {
  try {
    if (project.event_type === "oneTime" && project.schedule.oneTime) {
      const dateStr = project.schedule.oneTime.date;
      const [year, month, day] = dateStr.split("-").map(Number);
      return new Date(year, month - 1, day);
    } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
      const dates = project.schedule.multiDay.map((day) => {
        const [year, month, dayNum] = day.date.split("-").map(Number);
        return new Date(year, month - 1, dayNum);
      });
      return dates.length > 0
        ? new Date(Math.max(...dates.map((date) => date.getTime())))
        : null;
    } else if (
      project.event_type === "sameDayMultiArea" &&
      project.schedule.sameDayMultiArea
    ) {
      const dateStr = project.schedule.sameDayMultiArea.date;
      if (dateStr) {
        const [year, month, day] = dateStr.split("-").map(Number);
        return new Date(year, month - 1, day);
      }
    }
    return null;
  } catch {
    return null;
  }
};

export const getAutoDeletionDate = (project: Project): Date | null => {
  const projectEndDate = getProjectEndDate(project);
  return projectEndDate ? addDays(projectEndDate, 30) : null;
};

// Get slot timing info
export const getSlotTiming = (project: Project, scheduleId: string) => {
  let sessionDate = "";
  let endTime = "";

  if (project.event_type === "oneTime" && project.schedule.oneTime) {
    sessionDate = project.schedule.oneTime.date;
    endTime = project.schedule.oneTime.endTime;
  } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
    const slotData = getMultiDaySlotByScheduleId(project, scheduleId);
    if (slotData) {
      sessionDate = slotData.day.date;
      endTime = slotData.slot.endTime;
    }
  } else if (
    project.event_type === "sameDayMultiArea" &&
    project.schedule.sameDayMultiArea
  ) {
    const role = project.schedule.sameDayMultiArea.roles.find(
      (r) => r.name === scheduleId,
    );
    if (role) {
      sessionDate = project.schedule.sameDayMultiArea.date;
      endTime = role.endTime;
    }
  }

  return { sessionDate, endTime };
};
