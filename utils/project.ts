import { Project, ProjectStatus } from "@/types";
import { SupabaseClient } from "@supabase/supabase-js";
import { differenceInHours, parseISO, isAfter, isBefore, isEqual, set } from "date-fns";

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
  const now = new Date();
  
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
      throw new Error("Invalid event type");
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
      throw new Error("Invalid event type");
  }
};

export const getProjectStatus = (project: Project): ProjectStatus => {
  // If project is explicitly marked as cancelled, respect that status
  if (project.status === "cancelled") {
    return "cancelled";
  }

  const now = new Date();
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

export const canDeleteProject = (project: Project): boolean => {
  const now = new Date();
  const startDateTime = getProjectStartDateTime(project);
  const endDateTime = getProjectEndDateTime(project);
  
  const hoursUntilStart = differenceInHours(startDateTime, now);
  const hoursAfterEnd = differenceInHours(now, endDateTime);
  
  // For cancelled projects, use the same 72-hour window rule
  // Either more than 24 hours before start OR more than 48 hours after end
  if (project.status === "cancelled") {
    return hoursUntilStart > 24 || hoursAfterEnd > 48;
  }
  
  // For active projects, same 72-hour window rule applies
  // Cannot delete within 24 hours before start OR within 48 hours after end
  if (hoursUntilStart <= 24 || (hoursAfterEnd >= 0 && hoursAfterEnd <= 48)) {
    return false;
  }

  return true;
};

export const canCancelProject = (project: Project): boolean => {
  // Can't cancel already cancelled or completed projects
  if (project.status === "cancelled" || project.status === "completed") {
    return false;
  }

  const now = new Date();
  const startDateTime = getProjectStartDateTime(project);
  const hoursUntilStart = differenceInHours(startDateTime, now);
  
  // Can cancel up until the event starts
  return true // temporarrily allow...basically cancellation is always allowed
};

export const isProjectVisible = (
  project: Project, 
  userId?: string, 
  userOrganizations?: { organization_id: string; role: string }[]
): boolean => {
  // Public projects (is_private=false) are always visible
  if (!project.is_private) {
    return true;
  }

  // Private projects (is_private=true) require organization membership check
  if (project.is_private && project.organization_id) {
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
  supabase: SupabaseClient,
  projectId: string
): Promise<Record<string, number>> {
  const capacities: Record<string, number> = {};
  const scheduleIds: string[] = [];

  // Collect all schedule IDs and initial capacities
  if (project.event_type === "oneTime" && project.schedule.oneTime) {
    scheduleIds.push("oneTime");
    capacities["oneTime"] = project.schedule.oneTime.volunteers;
  } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
    project.schedule.multiDay.forEach((day, dayIndex) => {
      day.slots.forEach((slot, slotIndex) => {
        const scheduleId = `${day.date}-${slotIndex}`;
        scheduleIds.push(scheduleId);
        capacities[scheduleId] = slot.volunteers;
      });
    });
  } else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
    project.schedule.sameDayMultiArea.roles.forEach((role) => {
      scheduleIds.push(role.name);
      capacities[role.name] = role.volunteers;
    });
  }

  if (scheduleIds.length === 0) {
    return {}; // No schedules found
  }

  // Fetch counts of approved AND attended signups for these schedule IDs
  const { data: signups, error } = await supabase
    .from("project_signups")
    .select("schedule_id, status") // Select status to potentially group by later if needed, though count works directly
    .eq("project_id", projectId)
    .in("schedule_id", scheduleIds)
    // Use .in() or .or() to filter for multiple statuses
    .in("status", ["approved", "attended"]); // <-- Updated filter

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
    console.log("Invalid project or scheduleId:", { project: !!project, scheduleId });
    return null;
  }

  if (project.event_type === "oneTime") {
    if (scheduleId === "oneTime") {
      return project.schedule.oneTime;
    }
  } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
    // Improved parsing of scheduleId for multi-day events
    const parts = scheduleId.split("-");
    // For multi-day events, schedule ID should be date-slotIndex
    // parts[0] to parts[parts.length-2] is the date (in case date contains hyphens)
    // parts[parts.length-1] is the slot index
    if (parts.length >= 2) {
      const slotIndexStr = parts.pop(); // Get last element (slot index)
      const date = parts.join("-"); // Rejoin the rest as the date
      
      console.log("Parsing multiDay scheduleId:", { date, slotIndexStr, parts });
      
      const day = project.schedule.multiDay.find(d => d.date === date);
      if (day) {
        const slotIdx = parseInt(slotIndexStr!, 10);
        if (!isNaN(slotIdx) && slotIdx >= 0 && slotIdx < day.slots.length) {
          return day.slots[slotIdx];
        } else {
          console.log("Invalid slot index:", { slotIdx, slotsLength: day.slots.length });
        }
      } else {
        console.log("Day not found:", { date, availableDays: project.schedule.multiDay.map(d => d.date) });
      }
    } else {
      console.log("Invalid multiDay scheduleId format:", scheduleId);
    }
  } else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
    const role = project.schedule.sameDayMultiArea.roles.find(r => r.name === scheduleId);
    if (role) {
      return role;
    }
  }
  
  console.log("No slot found for scheduleId:", scheduleId);
  return null;
}

export function isSlotAvailable(
  project: Project, 
  scheduleId: string, 
  remainingSlots: Record<string, number>,
  clientStatus?: ProjectStatus // Add optional parameter to override project.status
): boolean {
  // Debug logging to help identify issues
  console.log("isSlotAvailable check:", {
    projectId: project.id,
    scheduleId,
    remainingSlots,
    projectType: project.event_type,
    effectiveStatus: clientStatus || project.status
  });

  // Use client-provided status if available, otherwise use project.status
  const effectiveStatus = clientStatus || project.status;
  
  // Check if the project is cancelled or completed
  if (effectiveStatus === "cancelled" || effectiveStatus === "completed") {
    console.log("Project is cancelled or completed, slot not available");
    return false;
  }
  
  // Check if the schedule ID is valid for this project
  const slotDetails = getSlotDetails(project, scheduleId);
  if (!slotDetails) {
    console.log("Invalid slot details for", scheduleId);
    return false;
  }
  
  // Check if there are remaining slots
  const slotsRemaining = remainingSlots[scheduleId];
  
  console.log("Slots remaining:", slotsRemaining, "for scheduleId:", scheduleId);
  
  return slotsRemaining !== undefined && slotsRemaining > 0;
}