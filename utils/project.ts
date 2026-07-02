import { Project, ProjectStatus } from "@/types";
import { format, parseISO, isAfter, isBefore, isEqual, addHours, subHours, isWithinInterval } from "date-fns";

const shouldLogProjectDebug = process.env.NODE_ENV === "development";

type SupabaseFromClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

type MultiDaySlotLike = {
  name?: string;
  startTime: string;
  endTime: string;
  volunteers?: number;
};

export function parseMultiDayScheduleId(scheduleId: string): { date: string; dayIndex?: number; slotIndex: number } | null {
  const parts = scheduleId.split("-");
  
  // Backward compatibility: YYYY-MM-DD-slotIndex (4 parts)
  if (parts.length === 4) {
    const [y, m, d, slotIdx] = parts;
    const slotIndex = Number.parseInt(slotIdx, 10);
    if (Number.isNaN(slotIndex)) return null;
    return { date: `${y}-${m}-${d}`, slotIndex };
  } 
  
  // New format: YYYY-MM-DD-dayIndex-slotIndex (5 parts)
  if (parts.length === 5) {
    const [y, m, d, dayIdx, slotIdx] = parts;
    const dayIndex = Number.parseInt(dayIdx, 10);
    const slotIndex = Number.parseInt(slotIdx, 10);
    if (Number.isNaN(dayIndex) || Number.isNaN(slotIndex)) return null;
    return { date: `${y}-${m}-${d}`, dayIndex, slotIndex };
  }

  return null;
}

export function getMultiDaySlotDisplayName(slot: MultiDaySlotLike, slotIndex: number): string {
  const trimmedName = slot.name?.trim();
  return trimmedName ? trimmedName : `Slot ${slotIndex + 1}`;
}

export function getMultiDaySlotByScheduleId(
  project: Project,
  scheduleId: string
): { day: NonNullable<Project["schedule"]["multiDay"]>[number]; slot: NonNullable<Project["schedule"]["multiDay"]>[number]["slots"][number]; slotIndex: number; dayIndex: number } | null {
  if (project.event_type !== "multiDay" || !project.schedule.multiDay) {
    return null;
  }

  const parsedScheduleId = parseMultiDayScheduleId(scheduleId);
  if (!parsedScheduleId) {
    return null;
  }

  const { date, dayIndex, slotIndex } = parsedScheduleId;
  
  let day;
  let actualDayIndex = -1;

  if (dayIndex !== undefined && dayIndex >= 0 && dayIndex < project.schedule.multiDay.length) {
    const candidateDay = project.schedule.multiDay[dayIndex];
    if (candidateDay.date === date) {
      day = candidateDay;
      actualDayIndex = dayIndex;
    }
  }

  if (!day) {
    actualDayIndex = project.schedule.multiDay.findIndex((entry) => entry.date === date);
    if (actualDayIndex === -1) return null;
    day = project.schedule.multiDay[actualDayIndex];
  }

  if (slotIndex >= day.slots.length) {
    return null;
  }

  const slot = day.slots[slotIndex];
  if (!slot) {
    return null;
  }

  return { day, slot, slotIndex, dayIndex: actualDayIndex };
}

/**
 * Resolves a potentially legacy schedule ID to the current unique ID format.
 * If the provided ID is already in the new unique format, it is returned as is.
 * If it's a legacy ID (YYYY-MM-DD-slotIndex), it tries to find the best match.
 */
export function resolveScheduleId(project: Project, scheduleId: string): string {
  if (project.event_type !== "multiDay" || !project.schedule.multiDay) {
    return scheduleId;
  }

  const parsed = parseMultiDayScheduleId(scheduleId);
  if (!parsed) return scheduleId;

  // If it already has dayIndex, it's the new format
  if (parsed.dayIndex !== undefined) {
    return scheduleId;
  }

  // Legacy format (YYYY-MM-DD-slotIndex): Find the first day that matches this date
  const { date, slotIndex } = parsed;
  const dayIndex = project.schedule.multiDay.findIndex((d) => d.date === date);
  
  if (dayIndex !== -1) {
    // Construct the new unique ID
    return `${date}-${dayIndex}-${slotIndex}`;
  }

  return scheduleId;
}

export const getProjectEventDate = (project: Project): Date => {
  switch (project.event_type) {
    case "oneTime":
      return parseISO(project.schedule.oneTime!.date);
    case "multiDay":
      // Get the earliest date for multi-day events
      return parseISO(project.schedule.multiDay![0].date);
    case "sameDayMultiArea":
      return parseISO(project.schedule.sameDayMultiArea!.date);
    default:
      throw new Error("Invalid event type");
  }
};

export const getProjectEndDate = (project: Project): Date => {
  switch (project.event_type) {
    case "oneTime":
      const date = parseISO(project.schedule.oneTime!.date);
      const [hours, minutes] = project.schedule.oneTime!.endTime.split(':').map(Number);
      return new Date(date.setHours(hours, minutes));
    case "multiDay":
      // Get the last date for multi-day events
      const lastDay = project.schedule.multiDay![project.schedule.multiDay!.length - 1];
      const lastDate = parseISO(lastDay.date);
      const [lastHours, lastMinutes] = lastDay.slots[lastDay.slots.length - 1].endTime.split(':').map(Number);
      return new Date(lastDate.setHours(lastHours, lastMinutes));
    case "sameDayMultiArea":
      const eventDate = parseISO(project.schedule.sameDayMultiArea!.date);
      const [endHours, endMinutes] = project.schedule.sameDayMultiArea!.overallEnd.split(':').map(Number);
      return new Date(eventDate.setHours(endHours, endMinutes));
    default:
      throw new Error("Invalid event type");
  }
};

// Get the earliest start time for any project type
export const getProjectStartDateTime = (project: Project): Date => {

  switch (project.event_type) {
    case "oneTime": {
      const date = parseISO(project.schedule.oneTime!.date);
      const [hours, minutes] = project.schedule.oneTime!.startTime.split(':').map(Number);
      return new Date(date.setHours(hours, minutes));
    }
    case "multiDay": {
      // Find the earliest start time across all days and slots
      let earliestDateTime: Date | null = null;

      project.schedule.multiDay!.forEach(day => {
        const dayDate = parseISO(day.date);

        day.slots.forEach(slot => {
          const [hours, minutes] = slot.startTime.split(':').map(Number);
          const slotStartTime = new Date(dayDate);
          slotStartTime.setHours(hours, minutes, 0, 0);

          if (!earliestDateTime || slotStartTime < earliestDateTime) {
            earliestDateTime = slotStartTime;
          }
        });
      });

      return earliestDateTime!;
    }
    case "sameDayMultiArea": {
      const date = parseISO(project.schedule.sameDayMultiArea!.date);
      const [hours, minutes] = project.schedule.sameDayMultiArea!.overallStart.split(':').map(Number);
      return new Date(date.setHours(hours, minutes));
    }
    default:
      // Unknown/legacy event_type — log and return epoch so the project
      // is treated as upcoming rather than crashing the page.
      console.warn(`[getProjectStartDateTime] Unknown event_type: "${(project as { event_type: string }).event_type}" on project ${project.id}`);
      return new Date(0);
  }
};

// Get the latest end time for any project type
export const getProjectEndDateTime = (project: Project): Date => {
  switch (project.event_type) {
    case "oneTime": {
      const date = parseISO(project.schedule.oneTime!.date);
      const [hours, minutes] = project.schedule.oneTime!.endTime.split(':').map(Number);
      return new Date(date.setHours(hours, minutes));
    }
    case "multiDay": {
      // Find the latest end time across all days and slots
      let latestDateTime: Date | null = null;

      project.schedule.multiDay!.forEach(day => {
        const dayDate = parseISO(day.date);

        day.slots.forEach(slot => {
          const [hours, minutes] = slot.endTime.split(':').map(Number);
          const slotEndTime = new Date(dayDate);
          slotEndTime.setHours(hours, minutes, 0, 0);

          if (!latestDateTime || slotEndTime > latestDateTime) {
            latestDateTime = slotEndTime;
          }
        });
      });

      return latestDateTime!;
    }
    case "sameDayMultiArea": {
      const date = parseISO(project.schedule.sameDayMultiArea!.date);
      const [hours, minutes] = project.schedule.sameDayMultiArea!.overallEnd.split(':').map(Number);
      return new Date(date.setHours(hours, minutes));
    }
    default:
      // Unknown/legacy event_type — return far-future so it shows as upcoming.
      console.warn(`[getProjectEndDateTime] Unknown event_type: "${(project as { event_type: string }).event_type}" on project ${project.id}`);
      return new Date(8640000000000000);
  }
};

export const getProjectStatus = (project: Project): ProjectStatus => {
  // If project is explicitly marked as cancelled, respect that status
  if (project.status === "cancelled") {
    return "cancelled";
  }

  // Draft projects should always be considered upcoming
  if (project.workflow_status === "draft") {
    return "upcoming";
  }

  // Guard against missing schedule data to avoid parse errors
  if (!project.schedule) {
    return "upcoming";
  }

  if (project.event_type === "oneTime" && !project.schedule.oneTime) {
    return "upcoming";
  }

  if (project.event_type === "multiDay" && (!project.schedule.multiDay || project.schedule.multiDay.length === 0)) {
    return "upcoming";
  }

  if (project.event_type === "sameDayMultiArea" && !project.schedule.sameDayMultiArea) {
    return "upcoming";
  }

  // Guard against unknown event_type (e.g. legacy/malformed DB rows like event_type='event')
  const knownEventTypes = ["oneTime", "multiDay", "sameDayMultiArea"];
  if (!knownEventTypes.includes(project.event_type)) {
    console.warn(`[getProjectStatus] Unknown event_type: "${(project as { event_type: string }).event_type}" on project ${project.id} — treating as upcoming`);
    return "upcoming";
  }

  const now = new Date();

  // For multiDay events, check if ANY day is still available
  if (project.event_type === "multiDay") {
    const hasAvailable = hasAvailableMultiDaySlots(project);

    if (!hasAvailable) {
      return "completed";
    }

    // Check if any day is currently in progress
    const multiDaySchedule = project.schedule.multiDay!;
    for (const day of multiDaySchedule) {
      const dayDate = parseISO(day.date);

      for (const slot of day.slots) {
        const [startHours, startMinutes] = slot.startTime.split(':').map(Number);
        const [endHours, endMinutes] = slot.endTime.split(':').map(Number);

        const slotStart = new Date(dayDate);
        slotStart.setHours(startHours, startMinutes, 0, 0);

        const slotEnd = new Date(dayDate);
        slotEnd.setHours(endHours, endMinutes, 0, 0);

        if ((isAfter(now, slotStart) && isBefore(now, slotEnd)) || isEqual(now, slotStart)) {
          return "in-progress";
        }
      }
    }

    // If we have available days but none are in progress, it's upcoming
    return "upcoming";
  }

  // For other event types, use existing logic
  const startDateTime = getProjectStartDateTime(project);
  const endDateTime = getProjectEndDateTime(project);

  // Check if the project is completed (after end time)
  if (isAfter(now, endDateTime)) {
    return "completed";
  }

  // Check if the project is in progress (between start and end time)
  if (isAfter(now, startDateTime) && isBefore(now, endDateTime) || isEqual(now, startDateTime)) {
    return "in-progress";
  }

  // If none of the above, the project is upcoming
  return "upcoming";
};

export const isWithinDeletionRestrictionWindow = (
  project: Project,
  now: Date = new Date()
): boolean => {
  const startWindow = subHours(getProjectStartDateTime(project), 24);
  const endWindow = addHours(getProjectEndDateTime(project), 48);
  return isWithinInterval(now, { start: startWindow, end: endWindow });
};

export const canDeleteProject = (project: Project): boolean => {
  return !isWithinDeletionRestrictionWindow(project);
};

export const canCancelProject = (project: Project): boolean => {
  // Can't cancel already cancelled or completed projects
  if (project.status === "cancelled" || project.status === "completed") {
    return false;
  }

  // Can cancel up until the event starts
  return true; // temporarily allow...basically cancellation is always allowed
};

export const isProjectVisible = (
  project: Project,
  userId?: string,
  userOrganizations?: { organization_id: string; role: string }[]
): boolean => {
  // Public projects are always visible
  if (project.visibility === 'public') {
    return true;
  }

  // Unlisted projects are visible to anyone with the link (always return true for direct access)
  if (project.visibility === 'unlisted') {
    return true;
  }

  // Organization-only projects require membership check
  if (project.visibility === 'organization_only' && project.organization_id) {
    // Must have user and their organizations to check
    if (!userId || !userOrganizations) {
      return false;
    }

    // Check if user is part of the organization
    return userOrganizations.some(org =>
      org.organization_id === project.organization_id
    );
  }

  return false;
};

export const canManageProject = (
  project: Project,
  userId?: string,
  userOrganizations?: { organization_id: string; role: string }[]
): boolean => {
  // Must have a user ID to manage projects
  if (!userId) {
    return false;
  }

  // Project creator can always manage their project
  if (project.creator_id === userId) {
    return true;
  }

  // For organization projects, check if user is admin/staff
  if (project.organization_id && userOrganizations) {
    const orgMembership = userOrganizations.find(
      org => org.organization_id === project.organization_id
    );

    if (orgMembership && (orgMembership.role === "admin" || orgMembership.role === "staff")) {
      return true;
    }
  }

  return false;
};

// Format status text for display (e.g., "in-progress" → "In progress")
export const formatStatusText = (status: string): string => {
  if (!status) return "Unknown";
  return status.charAt(0).toUpperCase() + status.slice(1).replace("-", " ");
};



// Function to get remaining slots for each schedule ID
export async function getSlotCapacities(
  project: Project,
  supabase: SupabaseFromClient,
  projectId: string
): Promise<Record<string, number>> {
  const capacities: Record<string, number> = {};
  const scheduleIds: string[] = [];
  const normalizeCapacity = (value: unknown): number => {
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
  };

  // Collect all schedule IDs and initial capacities
  if (project.event_type === "oneTime" && project.schedule.oneTime) {
    scheduleIds.push("oneTime");
    capacities["oneTime"] = normalizeCapacity(project.schedule.oneTime.volunteers);
  } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
    project.schedule.multiDay.forEach((day, dayIndex) => {
      day.slots.forEach((slot, slotIndex) => {
        const scheduleId = `${day.date}-${dayIndex}-${slotIndex}`;
        scheduleIds.push(scheduleId);
        capacities[scheduleId] = normalizeCapacity(slot.volunteers);
      });
    });
  } else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
    project.schedule.sameDayMultiArea.roles.forEach((role) => {
      scheduleIds.push(role.name);
      capacities[role.name] = normalizeCapacity(role.volunteers);
    });
  }

  if (scheduleIds.length === 0) {
    return {}; // No schedules found
  }

  // Fetch counts of approved AND attended signups for these schedule IDs
  const { data: signups, error } = (await supabase
    .from("project_signups")
    .select("schedule_id, status") // Select status to potentially group by later if needed, though count works directly
    .eq("project_id", projectId)
    .in("schedule_id", scheduleIds)
    // Use .in() or .or() to filter for multiple statuses
    .in("status", ["approved", "attended"])) as {
      data: { schedule_id: string; status: string }[] | null;
      error: { message: string } | null;
    }; // <-- Updated filter

  if (error) {
    console.error("Error fetching signup counts:", error);
    // Return initial capacities as a fallback, maybe log the error
    return capacities;
  }

  // Count signups per schedule ID
  const signupCounts: Record<string, number> = {};
  if (signups) {
    signups.forEach((signup) => {
      signupCounts[signup.schedule_id] = (signupCounts[signup.schedule_id] || 0) + 1;
    });
  }

  // Calculate remaining slots
  const remainingSlots: Record<string, number> = {};
  for (const scheduleId in capacities) {
    const totalCapacity = capacities[scheduleId];
    const filledSlots = signupCounts[scheduleId] || 0;
    remainingSlots[scheduleId] = Math.max(0, totalCapacity - filledSlots);
  }

  return remainingSlots;
}

export function getSlotDetails(project: Project, scheduleId: string) {
  if (!project || !scheduleId) {
    if (shouldLogProjectDebug) {
      console.log("Invalid project or scheduleId:", { project: !!project, scheduleId });
    }
    return null;
  }

  if (project.event_type === "oneTime") {
    if (scheduleId === "oneTime") {
      return project.schedule.oneTime;
    }
  } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
    const slotData = getMultiDaySlotByScheduleId(project, scheduleId);
    if (slotData) {
      return slotData.slot;
    }

    if (shouldLogProjectDebug) {
      console.log("Invalid multiDay scheduleId format:", scheduleId);
    }
  } else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
    const role = project.schedule.sameDayMultiArea.roles.find(r => r.name === scheduleId);
    if (role) {
      return role;
    }
  }

  if (shouldLogProjectDebug) {
    console.log("No slot found for scheduleId:", scheduleId);
  }
  return null;
}

export function isSlotAvailable(
  project: Project,
  scheduleId: string,
  remainingSlots: Record<string, number>,
  clientStatus?: ProjectStatus // Add optional parameter to override project.status
): boolean {
  // Debug logging to help identify issues
  if (shouldLogProjectDebug) {
    console.log("isSlotAvailable check:", {
      projectId: project.id,
      scheduleId,
      remainingSlots,
      projectType: project.event_type,
      effectiveStatus: clientStatus || project.status
    });
  }

  // Use client-provided status if available, otherwise use project.status
  const effectiveStatus = clientStatus || project.status;

  // Check if the project is cancelled or completed
  if (effectiveStatus === "cancelled" || effectiveStatus === "completed") {
    if (shouldLogProjectDebug) {
      console.log("Project is cancelled or completed, slot not available");
    }
    return false;
  }

  // Check if the schedule ID is valid for this project
  const slotDetails = getSlotDetails(project, scheduleId);
  if (!slotDetails) {
    if (shouldLogProjectDebug) {
      console.log("Invalid slot details for", scheduleId);
    }
    return false;
  }

  // Check if there are remaining slots
  const slotsRemaining = remainingSlots[scheduleId];

  if (shouldLogProjectDebug) {
    console.log("Slots remaining:", slotsRemaining, "for scheduleId:", scheduleId);
  }

  return Number.isFinite(slotsRemaining) && slotsRemaining > 0;
}

// Check if a specific multi-day slot has passed
export function isMultiDaySlotPast(day: { date: string; slots: Array<{ endTime: string }> }): boolean {
  if (!day.slots || day.slots.length === 0) return true;

  const latestSlot = day.slots[day.slots.length - 1];
  const dayDate = parseISO(day.date);
  const [hours, minutes] = latestSlot.endTime.split(':').map(Number);
  const dayEndDateTime = new Date(dayDate);
  dayEndDateTime.setHours(hours, minutes, 0, 0);

  const now = new Date();
  return isAfter(now, dayEndDateTime);
}

// Get available days for signup (filters out past days)
export function getAvailableMultiDaySlots(project: Project): number[] {
  if (project.event_type !== 'multiDay' || !project.schedule.multiDay) {
    return [];
  }

  return project.schedule.multiDay
    .map((day, index) => ({ day, index }))
    .filter(({ day }) => !isMultiDaySlotPast(day))
    .map(({ index }) => index);
}

// Check if ANY day is still available
export function hasAvailableMultiDaySlots(project: Project): boolean {
  return getAvailableMultiDaySlots(project).length > 0;
}

// Check if a specific slot within a multi-day event has passed
export function isMultiDaySlotPastByScheduleId(_project: Project, scheduleId: string): boolean {
  const slotData = getMultiDaySlotByScheduleId(_project, scheduleId);
  if (!slotData) return false;

  const { day, slot } = slotData;
  const dayDate = parseISO(day.date);
  const [hours, minutes] = slot.endTime.split(':').map(Number);
  const slotEndDateTime = new Date(dayDate);
  slotEndDateTime.setHours(hours, minutes, 0, 0);

  const now = new Date();
  return isAfter(now, slotEndDateTime);
}

// Check if a specific slot within a sameDayMultiArea event has passed
export function isSameDayMultiAreaSlotPast(project: Project, scheduleId: string): boolean {
  if (project.event_type !== 'sameDayMultiArea' || !project.schedule.sameDayMultiArea) {
    return false;
  }

  const role = project.schedule.sameDayMultiArea.roles.find((r) => r.name === scheduleId);
  if (!role) return false;

  const eventDate = parseISO(project.schedule.sameDayMultiArea.date);
  const [hours, minutes] = role.endTime.split(':').map(Number);
  const slotEndDateTime = new Date(eventDate);
  slotEndDateTime.setHours(hours, minutes, 0, 0);

  const now = new Date();
  return isAfter(now, slotEndDateTime);
}

// Check if a oneTime slot has passed
export function isOneTimeSlotPast(project: Project): boolean {
  if (project.event_type !== 'oneTime' || !project.schedule.oneTime) {
    return false;
  }

  const eventDate = parseISO(project.schedule.oneTime.date);
  const [hours, minutes] = project.schedule.oneTime.endTime.split(':').map(Number);
  const slotEndDateTime = new Date(eventDate);
  slotEndDateTime.setHours(hours, minutes, 0, 0);

  const now = new Date();
  return isAfter(now, slotEndDateTime);
}

// Formats the date display for different project types
export function formatDateDisplay(project: Project) {
  if (!project.event_type || !project.schedule) return "";

  switch (project.event_type) {
    case "oneTime": {
      const dateStr = project.schedule.oneTime?.date;
      if (!dateStr) return "Date not specified";
      try {
        return format(parseISO(dateStr), "MMM d, yyyy");
      } catch {
        return "Date not specified";
      }
    }
    case "multiDay": {
      if (!project.schedule.multiDay || project.schedule.multiDay.length === 0) {
        return "Date not specified";
      }
      try {
        const dates = project.schedule.multiDay
          .map((day) => parseISO(day.date))
          .sort((a: Date, b: Date) => a.getTime() - b.getTime());

        return `${format(dates[0], "MMM d")} - ${format(dates[dates.length - 1], "MMM d, yyyy")}`;
      } catch {
        return "Date not specified";
      }
    }
    case "sameDayMultiArea": {
      const dateStr = project.schedule.sameDayMultiArea?.date;
      if (!dateStr) return "Date not specified";
      try {
        return format(parseISO(dateStr), "MMM d, yyyy");
      } catch {
        return "Date not specified";
      }
    }
    default:
      return "Date not specified";
  }
}
