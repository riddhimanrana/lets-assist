import { Project, ProjectStatus } from "@/types";

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

export function getSlotCapacities(project: Project): Record<string, number> {
  const capacities: Record<string, number> = {};
  
  if (project.event_type === "oneTime" && project.schedule.oneTime) {
    capacities["oneTime"] = project.schedule.oneTime.volunteers;
  } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
    project.schedule.multiDay.forEach((day) => {
      day.slots.forEach((slot, slotIndex) => {
        const scheduleId = `${day.date}-${slotIndex}`;
        capacities[scheduleId] = slot.volunteers;
      });
    });
  } else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
    project.schedule.sameDayMultiArea.roles.forEach(role => {
      capacities[role.name] = role.volunteers;
    });
  }
  
  return capacities;
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