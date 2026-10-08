import type { Project } from "@/types";
import type { SignupStatus } from "@/types/common";
import type { WaiverPreviewSignature } from "@/components/projects/WaiverPreviewDialog";
import {
  formatScheduleDisplay,
  formatDateForDisplay,
  ProjectScheduleTime,
} from "@/utils/timezone";
import { getMultiDaySlotDisplayName } from "@/utils/project";

export type OrganizerSignup = {
  id: string;
  created_at: string;
  status: SignupStatus;
  user_id: string | null;
  anonymous_id: string | null; // FK to anonymous_signups
  schedule_id: string;
  volunteer_comment?: string | null;
  response_data?: Record<string, unknown> | null;
  waiver_signature?: WaiverPreviewSignature | WaiverPreviewSignature[];
  profile?: {
    // Data from profiles table (if user_id exists)
    full_name: string;
    username: string;
    email: string;
    phone?: string;
  };
  anonymous_signup?: {
    // Data from anonymous_signups table (if anonymous_id exists)
    id: string;
    name: string;
    email: string;
    phone_number?: string | null;
    confirmed_at?: string | null;
  };
};

export const formatScheduleSlot = (project: Project, slotId: string) => {
  if (!project) return slotId;

  const projectTimezone = project.project_timezone || "America/Los_Angeles"; // Default to ET if not set

  if (project.event_type === "oneTime") {
    // Handle oneTime events - the scheduleId is simply "oneTime"
    if (slotId === "oneTime" && project.schedule.oneTime) {
      const scheduleTime: ProjectScheduleTime = {
        date: project.schedule.oneTime.date,
        startTime: project.schedule.oneTime.startTime,
        endTime: project.schedule.oneTime.endTime,
      };

      const dateDisplay = formatDateForDisplay(scheduleTime.date);
      const timeDisplay = formatScheduleDisplay(
        scheduleTime,
        projectTimezone,
        undefined,
        true,
      );

      return `${dateDisplay} from ${timeDisplay}`;
    }
  }

  if (project.event_type === "multiDay") {
    // For multiDay events, the scheduleId format is "date-slotIndex"
    const parts = slotId.split("-");

    // Make sure we have at least 2 parts (date and slotIndex)
    if (parts.length >= 2) {
      // Last part is the slot index
      const slotIndex = parts.pop();
      // Everything else is the date (in case the date has hyphens)
      const date = parts.join("-");

      const day = project.schedule.multiDay?.find((d) => d.date === date);

      if (day && slotIndex !== undefined) {
        const slotIdx = parseInt(slotIndex, 10);
        const slot = day.slots[slotIdx];

        if (slot) {
          const scheduleTime: ProjectScheduleTime = {
            date: date,
            startTime: slot.startTime,
            endTime: slot.endTime,
          };

          const dateDisplay = formatDateForDisplay(scheduleTime.date);
          const timeDisplay = formatScheduleDisplay(
            scheduleTime,
            projectTimezone,
            undefined,
            true,
          );
          const slotLabel = getMultiDaySlotDisplayName(slot, slotIdx);

          return `${dateDisplay} - ${slotLabel} (${timeDisplay})`;
        }
      }
    }
  }

  if (project.event_type === "sameDayMultiArea") {
    // For sameDayMultiArea, the scheduleId is the role name
    const role = project.schedule.sameDayMultiArea?.roles.find(
      (r) => r.name === slotId,
    );

    if (role) {
      const eventDate = project.schedule.sameDayMultiArea?.date;
      if (eventDate) {
        const scheduleTime: ProjectScheduleTime = {
          date: eventDate,
          startTime: role.startTime,
          endTime: role.endTime,
        };

        const dateDisplay = formatDateForDisplay(scheduleTime.date);
        const timeDisplay = formatScheduleDisplay(
          scheduleTime,
          projectTimezone,
          undefined,
          true,
        );

        return `${dateDisplay} - Role: ${role.name} (${timeDisplay})`;
      } else {
        const scheduleTime: ProjectScheduleTime = {
          date: new Date().toISOString().split("T")[0], // fallback date
          startTime: role.startTime,
          endTime: role.endTime,
        };
        const timeDisplay = formatScheduleDisplay(
          scheduleTime,
          projectTimezone,
          undefined,
          true,
        );
        return `Role: ${role.name} (${timeDisplay})`;
      }
    }
  }

  return slotId;
};
