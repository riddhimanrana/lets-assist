import { format } from "date-fns";
import type { Project } from "@/types";

export type Attendance = {
  id: string;
  check_in_time: string | null;
  check_out_time: string | null;
  schedule_id: string;
  user_id: string | null;
  anonymous_id: string | null;
  profile?: {
    full_name: string;
    username: string;
    email: string;
    phone?: string;
  };
  anonymous_signup?: {
    id: string;
    name: string;
    email: string;
    phone_number?: string | null;
  };
};

const formatTimeTo12Hour = (time: string) => {
  if (!time) return "";
  const [hours, minutes] = time.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const adjustedHours = hours % 12 || 12;
  return `${adjustedHours}:${minutes.toString().padStart(2, "0")} ${period}`;
};

export const formatSessionName = (project: Project, sessionId: string) => {
  if (sessionId === "all") return "All sessions";
  if (!project) return sessionId;

  if (project.event_type === "oneTime") {
    if (
      (sessionId === "oneTime" ||
        sessionId === "0" ||
        sessionId === "default") &&
      project.schedule.oneTime
    ) {
      const dateStr = project.schedule.oneTime.date;
      const [year, month, day] = dateStr.split("-").map(Number);
      const date = new Date(year, month - 1, day);
      return `${format(date, "MMMM d, yyyy")} from ${formatTimeTo12Hour(project.schedule.oneTime.startTime)} to ${formatTimeTo12Hour(project.schedule.oneTime.endTime)}`;
    }
  }

  if (project.event_type === "multiDay") {
    // Handle day-X-slot-Y format
    if (sessionId.startsWith("day-") && project.schedule.multiDay) {
      const parts = sessionId.split("-");
      if (parts.length >= 4) {
        const dayIndex = parseInt(parts[1], 10);
        const slotIndex = parseInt(parts[3], 10);
        const day = project.schedule.multiDay[dayIndex];
        const slot = day?.slots[slotIndex];
        if (day && slot) {
          const [year, month, d] = day.date.split("-").map(Number);
          const utcDate = new Date(year, month - 1, d);
          return `${format(utcDate, "EEEE, MMMM d, yyyy")} from ${formatTimeTo12Hour(slot.startTime)} to ${formatTimeTo12Hour(slot.endTime)}`;
        }
      }
    }

    // Handle legacy date-slotIndex format or simplified format
    const parts = sessionId.split("-");

    if (parts.length >= 2) {
      const slotPart = parts.pop();
      const date = parts.join("-");

      const day = project.schedule.multiDay?.find((d) => d.date === date);

      if (day && slotPart !== undefined) {
        const slotIdx = parseInt(slotPart, 10);
        const slot = day.slots[slotIdx];

        if (slot) {
          const [year, month, dayNum] = date.split("-").map(Number);
          const utcDate = new Date(year, month - 1, dayNum);
          return `${format(utcDate, "EEEE, MMMM d, yyyy")} from ${formatTimeTo12Hour(slot.startTime)} to ${formatTimeTo12Hour(slot.endTime)}`;
        }
      }
    }
  }

  if (project.event_type === "sameDayMultiArea") {
    const role = project.schedule.sameDayMultiArea?.roles.find(
      (r) => r.name === sessionId,
    );

    if (role) {
      const eventDate = project.schedule.sameDayMultiArea?.date;
      if (eventDate) {
        const [year, month, day] = eventDate.split("-").map(Number);
        const utcDate = new Date(year, month - 1, day);
        return `${format(utcDate, "EEEE, MMMM d, yyyy")} - Role: ${role.name} (${formatTimeTo12Hour(role.startTime)} to ${formatTimeTo12Hour(role.endTime)})`;
      } else {
        return `Role: ${role.name} (${formatTimeTo12Hour(role.startTime)} to ${formatTimeTo12Hour(role.endTime)})`;
      }
    }
  }

  return sessionId;
};
