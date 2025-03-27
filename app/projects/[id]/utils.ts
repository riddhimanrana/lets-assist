import { Project, EventType } from "@/types";

export function getSlotCapacities(project: Project) {
  if (project.event_type === "oneTime") {
    return { "oneTime": project.schedule.oneTime?.volunteers || 0 };
  } else if (project.event_type === "multiDay") {
    return project.schedule.multiDay?.reduce((acc, day) => {
      day.slots.forEach((slot, slotIndex) => {
        acc[`${day.date}-${slotIndex}`] = slot.volunteers;
      });
      return acc;
    }, {} as Record<string, number>) || {};
  } else {
    return project.schedule.sameDayMultiArea?.roles.reduce((acc, role) => {
      acc[role.name] = role.volunteers;
      return acc;
    }, {} as Record<string, number>) || {};
  }
}

export function getSlotDetails(project: Project, scheduleId: string) {
  if (project.event_type === "oneTime") {
    return { ...project.schedule.oneTime, id: "oneTime" };
  } else if (project.event_type === "multiDay") {
    const [date, slotIndex] = scheduleId.split("-");
    const day = project.schedule.multiDay?.find(d => d.date === date);
    const slot = day?.slots[parseInt(slotIndex)];
    return slot ? { ...slot, id: scheduleId } : null;
  } else if (project.event_type === "sameDayMultiArea") {
    const role = project.schedule.sameDayMultiArea?.roles.find(r => r.name === scheduleId);
    return role ? { ...role, id: scheduleId } : null;
  }
  return null;
}

export function isSlotAvailable(project: Project, scheduleId: string, remainingSlots: Record<string, number>) {
  if (project.status === "cancelled" || project.status === "completed") {
    return false;
  }
  return (remainingSlots[scheduleId] || 0) > 0;
}
