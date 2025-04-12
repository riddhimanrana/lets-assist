import { Project, ProjectStatus } from "@/types";
import { SupabaseClient } from "@supabase/supabase-js"; // Import SupabaseClient

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

// Updated function signature to be async and accept supabase client + projectId
export async function getSlotCapacities(
  project: Project, 
  supabase: SupabaseClient, // Add Supabase client parameter
  projectId: string // Add projectId parameter
): Promise<Record<string, number>> { // Return a Promise
  const totalCapacities: Record<string, number> = {};
  
  // Calculate total capacities based on project schedule (same logic as before)
  if (project.event_type === "oneTime" && project.schedule.oneTime) {
    totalCapacities["oneTime"] = project.schedule.oneTime.volunteers;
  } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
    project.schedule.multiDay.forEach((day) => {
      day.slots.forEach((slot, slotIndex) => {
        const scheduleId = `${day.date}-${slotIndex}`;
        totalCapacities[scheduleId] = slot.volunteers;
      });
    });
  } else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
    project.schedule.sameDayMultiArea.roles.forEach(role => {
      totalCapacities[role.name] = role.volunteers;
    });
  }

  // Fetch approved signups for this project
  const { data: signups, error } = await supabase
    .from("project_signups")
    .select("schedule_id")
    .eq("project_id", projectId)
    .eq("status", "approved");

  if (error) {
    console.error("Error fetching signups:", error);
    // Return total capacities as a fallback in case of error? Or throw?
    // For now, let's return total, but ideally handle this error better.
    return totalCapacities; 
  }

  // Count signups per schedule ID
  const signupCounts: Record<string, number> = {};
  if (signups) {
    signups.forEach((signup: { schedule_id: string }) => {
      signupCounts[signup.schedule_id] = (signupCounts[signup.schedule_id] || 0) + 1;
    });
  }

  // Calculate remaining capacities
  const remainingCapacities: Record<string, number> = {};
  for (const scheduleId in totalCapacities) {
    const total = totalCapacities[scheduleId];
    const count = signupCounts[scheduleId] || 0;
    remainingCapacities[scheduleId] = Math.max(0, total - count); // Ensure it doesn't go below 0
  }
  
  console.log("Calculated Remaining Capacities:", remainingCapacities); // Added for debugging
  return remainingCapacities;
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