"use client";

import { useState } from "react";
import type * as z from "zod";
import type { Project } from "@/types";
import {
  initializeRecurrenceState,
  initializeScheduleState,
} from "./edit-project-form";

/** The editable schedule and recurrence of a project, with their updaters. */
export function useEditProjectSchedule(project: Project) {
  const [scheduleState, setScheduleState] = useState(() =>
    initializeScheduleState(project),
  );
  const [recurrenceState, setRecurrenceState] = useState(() =>
    initializeRecurrenceState(project),
  );
  const [scheduleErrors, setScheduleErrors] = useState<z.ZodIssue[]>([]);

  // Schedule update handlers
  const updateOneTimeSchedule = (
    field: keyof typeof scheduleState.oneTime,
    value: string | number,
  ) => {
    setScheduleState((prev) => ({
      ...prev,
      oneTime: { ...prev.oneTime, [field]: value },
    }));
  };

  const updateMultiDaySchedule = (
    dayIndex: number,
    field: string,
    value: string | number,
    slotIndex?: number,
  ) => {
    setScheduleState((prev) => {
      const newMultiDay = [...prev.multiDay];
      if (slotIndex !== undefined) {
        newMultiDay[dayIndex].slots[slotIndex] = {
          ...newMultiDay[dayIndex].slots[slotIndex],
          [field]: value,
        };
      } else {
        newMultiDay[dayIndex] = { ...newMultiDay[dayIndex], [field]: value };
      }
      return { ...prev, multiDay: newMultiDay };
    });
  };

  const updateMultiRoleSchedule = (
    field: string,
    value: string | number,
    roleIndex?: number,
  ) => {
    setScheduleState((prev) => {
      if (roleIndex !== undefined) {
        const newRoles = [...prev.sameDayMultiArea.roles];
        newRoles[roleIndex] = { ...newRoles[roleIndex], [field]: value };
        return {
          ...prev,
          sameDayMultiArea: { ...prev.sameDayMultiArea, roles: newRoles },
        };
      } else {
        return {
          ...prev,
          sameDayMultiArea: { ...prev.sameDayMultiArea, [field]: value },
        };
      }
    });
  };

  const addMultiDaySlot = (dayIndex: number) => {
    setScheduleState((prev) => {
      const newMultiDay = [...prev.multiDay];
      newMultiDay[dayIndex].slots.push({
        name: "",
        startTime: "",
        endTime: "",
        volunteers: 0,
      });
      return { ...prev, multiDay: newMultiDay };
    });
  };

  const addMultiDayEvent = () => {
    setScheduleState((prev) => ({
      ...prev,
      multiDay: [
        ...prev.multiDay,
        {
          date: "",
          slots: [{ name: "", startTime: "", endTime: "", volunteers: 0 }],
        },
      ],
    }));
  };

  const addRole = () => {
    setScheduleState((prev) => ({
      ...prev,
      sameDayMultiArea: {
        ...prev.sameDayMultiArea,
        roles: [
          ...prev.sameDayMultiArea.roles,
          { name: "", startTime: "", endTime: "", volunteers: 0 },
        ],
      },
    }));
  };

  const removeDay = (dayIndex: number) => {
    setScheduleState((prev) => ({
      ...prev,
      multiDay: prev.multiDay.filter((_, i) => i !== dayIndex),
    }));
  };

  const removeSlot = (dayIndex: number, slotIndex: number) => {
    setScheduleState((prev) => {
      const newMultiDay = [...prev.multiDay];
      newMultiDay[dayIndex].slots = newMultiDay[dayIndex].slots.filter(
        (_, i) => i !== slotIndex,
      );
      return { ...prev, multiDay: newMultiDay };
    });
  };

  const removeRole = (roleIndex: number) => {
    setScheduleState((prev) => ({
      ...prev,
      sameDayMultiArea: {
        ...prev.sameDayMultiArea,
        roles: prev.sameDayMultiArea.roles.filter((_, i) => i !== roleIndex),
      },
    }));
  };

  const updateRecurrence = (
    field: keyof typeof recurrenceState,
    value: (typeof recurrenceState)[keyof typeof recurrenceState],
  ) => {
    setRecurrenceState((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  return {
    scheduleState,
    recurrenceState,
    scheduleErrors,
    setScheduleErrors,
    updateOneTimeSchedule,
    updateMultiDaySchedule,
    updateMultiRoleSchedule,
    addMultiDaySlot,
    addMultiDayEvent,
    addRole,
    removeDay,
    removeSlot,
    removeRole,
    updateRecurrence,
  };
}
