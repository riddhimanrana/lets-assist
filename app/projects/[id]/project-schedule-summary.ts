import type { Project, SameDayMultiAreaRole } from "@/types";
import { getMultiDaySlotByScheduleId } from "@/utils/project";

/** The date and time range of one schedule slot, for the signup modals. */
export function getScheduleSlotSummary(project: Project, scheduleId: string) {
  if (project.event_type === "oneTime" && project.schedule.oneTime) {
    return {
      date: project.schedule.oneTime.date,
      start_time: project.schedule.oneTime.startTime,
      end_time: project.schedule.oneTime.endTime,
    };
  }

  if (project.event_type === "multiDay" && project.schedule.multiDay) {
    const slotData = getMultiDaySlotByScheduleId(project, scheduleId);
    return {
      date: slotData?.day.date || project.schedule.multiDay[0]?.date || "",
      start_time: slotData?.slot.startTime,
      end_time: slotData?.slot.endTime,
    };
  }

  if (
    project.event_type === "sameDayMultiArea" &&
    project.schedule.sameDayMultiArea
  ) {
    const role = project.schedule.sameDayMultiArea.roles.find(
      (r: SameDayMultiAreaRole) => r.name === scheduleId,
    );
    return {
      date: project.schedule.sameDayMultiArea.date,
      start_time: role?.startTime,
      end_time: role?.endTime,
    };
  }

  return { date: "", start_time: undefined, end_time: undefined };
}
