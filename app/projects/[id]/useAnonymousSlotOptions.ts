"use client";

import { useCallback, useMemo } from "react";
import { format } from "date-fns";
import type { Project, ProjectStatus } from "@/types";
import { formatSpotsLeft } from "@/lib/projects/availability";
import { formatTimeTo12Hour } from "@/lib/utils";
import {
  getMultiDaySlotDisplayName,
  isMultiDaySlotPastByScheduleId,
  isSameDayMultiAreaSlotPast,
} from "@/utils/project";
import type { AnonymousSlotOption } from "./project-details-types";

/** The slots a signed-out volunteer can still pick in the multi-slot dialog. */
export function useAnonymousSlotOptions({
  project,
  isCreator,
  calculatedStatus,
  hasSignedUp,
  rejectedSlots,
  attendedSlots,
  remainingSlots,
}: {
  project: Project;
  isCreator: boolean;
  calculatedStatus: ProjectStatus;
  hasSignedUp: Record<string, boolean>;
  rejectedSlots: Record<string, boolean>;
  attendedSlots: Record<string, boolean>;
  remainingSlots: Record<string, number>;
}) {
  const isAnonymousSlotSelectable = useCallback(
    (scheduleId: string) => {
      if (isCreator || calculatedStatus === "cancelled") return false;
      if (
        hasSignedUp[scheduleId] ||
        rejectedSlots[scheduleId] ||
        attendedSlots[scheduleId]
      )
        return false;
      if ((remainingSlots[scheduleId] ?? 0) === 0) return false;

      if (project.event_type === "multiDay") {
        return !isMultiDaySlotPastByScheduleId(project, scheduleId);
      }

      if (project.event_type === "sameDayMultiArea") {
        return !isSameDayMultiAreaSlotPast(project, scheduleId);
      }

      return true;
    },
    [
      isCreator,
      calculatedStatus,
      hasSignedUp,
      rejectedSlots,
      attendedSlots,
      remainingSlots,
      project,
    ],
  );

  const formatScheduleDateLabel = useCallback((dateStr: string) => {
    const [year, month, dayNum] = dateStr.split("-").map(Number);
    if (!year || !month || !dayNum) return dateStr;
    const date = new Date(year, month - 1, dayNum);
    if (isNaN(date.getTime())) return dateStr;
    return format(date, "EEE, MMM d");
  }, []);

  const anonymousSlotOptions = useMemo<AnonymousSlotOption[]>(() => {
    if (project.event_type === "oneTime") {
      return [];
    }

    if (project.event_type === "multiDay" && project.schedule.multiDay) {
      return project.schedule.multiDay.flatMap((day, dayIndex) => {
        return day.slots
          .map((slot, idx) => {
            const scheduleId = `${day.date}-${dayIndex}-${idx}`;
            if (!isAnonymousSlotSelectable(scheduleId)) return null;

            const startLabel = slot.startTime
              ? formatTimeTo12Hour(slot.startTime)
              : "TBD";
            const endLabel = slot.endTime
              ? formatTimeTo12Hour(slot.endTime)
              : undefined;
            const timeLabel = endLabel
              ? `${startLabel} - ${endLabel}`
              : startLabel;

            return {
              scheduleId,
              title: `${formatScheduleDateLabel(day.date)} · ${getMultiDaySlotDisplayName(slot, idx)}`,
              subtitle: `${timeLabel} • ${formatSpotsLeft(remainingSlots[scheduleId] ?? slot.volunteers, slot.volunteers)}`,
            };
          })
          .filter(
            (slotOption): slotOption is AnonymousSlotOption => !!slotOption,
          );
      });
    }

    if (
      project.event_type === "sameDayMultiArea" &&
      project.schedule.sameDayMultiArea
    ) {
      return project.schedule.sameDayMultiArea.roles
        .map((role) => {
          const scheduleId = role.name;
          if (!isAnonymousSlotSelectable(scheduleId)) return null;

          const startLabel = role.startTime
            ? formatTimeTo12Hour(role.startTime)
            : "TBD";
          const endLabel = role.endTime
            ? formatTimeTo12Hour(role.endTime)
            : undefined;
          const timeLabel = endLabel
            ? `${startLabel} - ${endLabel}`
            : startLabel;

          return {
            scheduleId,
            title: role.name,
            subtitle: `${timeLabel} • ${formatSpotsLeft(remainingSlots[scheduleId] ?? role.volunteers, role.volunteers)}`,
          };
        })
        .filter(
          (slotOption): slotOption is AnonymousSlotOption => !!slotOption,
        );
    }

    return [];
  }, [
    project,
    isCreator,
    calculatedStatus,
    hasSignedUp,
    rejectedSlots,
    attendedSlots,
    remainingSlots,
    isAnonymousSlotSelectable,
    formatScheduleDateLabel,
  ]);

  return anonymousSlotOptions;
}
