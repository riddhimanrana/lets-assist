import type { useEventForm } from "@/hooks/use-event-form";

import type { AIParseResult } from "./AIAssistant";

type EventForm = ReturnType<typeof useEventForm>;

type AIScheduleSlot = {
  name?: string;
  startTime: string;
  endTime: string;
  volunteers: number;
};
type AIScheduleDay = { date: string; slots?: AIScheduleSlot[] };
type AIScheduleRole = {
  name: string;
  startTime: string;
  endTime: string;
  volunteers: number;
};
type AIScheduleSameDay = {
  date: string;
  overallStart?: string;
  overallEnd?: string;
  roles?: AIScheduleRole[];
};
type AIScheduleOneTime = {
  date: string;
  startTime?: string;
  endTime?: string;
  volunteers?: number;
};

export interface ApplyAIDataContext {
  state: EventForm["state"];
  setEventType: EventForm["setEventType"];
  addMultiDaySlot: EventForm["addMultiDaySlot"];
  addMultiDayEvent: EventForm["addMultiDayEvent"];
  addRole: EventForm["addRole"];
  removeDay: EventForm["removeDay"];
  removeRole: EventForm["removeRole"];
  updateVerificationMethod: EventForm["updateVerificationMethod"];
  updateRequireLogin: EventForm["updateRequireLogin"];
  updateRecurrence: EventForm["updateRecurrence"];
  handleBasicInfoUpdate: EventForm["updateBasicInfo"];
  handleOneTimeScheduleUpdate: EventForm["updateOneTimeSchedule"];
  handleMultiDayScheduleUpdate: EventForm["updateMultiDaySchedule"];
  handleMultiRoleScheduleUpdate: EventForm["updateMultiRoleSchedule"];
}

/**
 * Writes an AI-parsed project into the form. Moved out of ProjectCreator
 * unchanged; the caller closes the assistant and points at the location field
 * afterwards.
 */
export function applyAIProjectData(
  data: AIParseResult,
  {
    state,
    setEventType,
    addMultiDaySlot,
    addMultiDayEvent,
    addRole,
    removeDay,
    removeRole,
    updateVerificationMethod,
    updateRequireLogin,
    updateRecurrence,
    handleBasicInfoUpdate,
    handleOneTimeScheduleUpdate,
    handleMultiDayScheduleUpdate,
    handleMultiRoleScheduleUpdate,
  }: ApplyAIDataContext,
) {
  // Apply basic info
  if (data.title) {
    handleBasicInfoUpdate("title", data.title);
  }
  if (data.location) {
    handleBasicInfoUpdate("location", data.location);
  }
  if (data.description) {
    handleBasicInfoUpdate("description", data.description);
  }

  // Apply event type
  if (data.eventType) {
    setEventType(data.eventType);
  }

  // Apply schedule based on event type
  if (data.schedule && data.eventType) {
    if (
      data.eventType === "oneTime" &&
      (data.schedule as AIScheduleOneTime).date
    ) {
      const schedule = data.schedule as AIScheduleOneTime;
      handleOneTimeScheduleUpdate("date", schedule.date);
      if (schedule.startTime)
        handleOneTimeScheduleUpdate("startTime", schedule.startTime);
      if (schedule.endTime)
        handleOneTimeScheduleUpdate("endTime", schedule.endTime);
      if (schedule.volunteers)
        handleOneTimeScheduleUpdate("volunteers", schedule.volunteers);
    } else if (data.eventType === "multiDay" && Array.isArray(data.schedule)) {
      // Clear existing days first
      const currentDays = state.schedule.multiDay.length;
      for (let i = currentDays - 1; i >= 0; i--) {
        removeDay(i);
      }

      // Add new days from AI
      (data.schedule as AIScheduleDay[]).forEach((day, dayIndex) => {
        if (dayIndex === 0) {
          // Update first day
          handleMultiDayScheduleUpdate(0, "date", day.date);
          if (Array.isArray(day.slots)) {
            day.slots.forEach((slot, slotIndex) => {
              if (slotIndex === 0) {
                handleMultiDayScheduleUpdate(0, "name", slot.name || "", 0);
                handleMultiDayScheduleUpdate(0, "startTime", slot.startTime, 0);
                handleMultiDayScheduleUpdate(0, "endTime", slot.endTime, 0);
                handleMultiDayScheduleUpdate(
                  0,
                  "volunteers",
                  slot.volunteers,
                  0,
                );
              } else {
                addMultiDaySlot(0);
                handleMultiDayScheduleUpdate(
                  0,
                  "name",
                  slot.name || "",
                  slotIndex,
                );
                handleMultiDayScheduleUpdate(
                  0,
                  "startTime",
                  slot.startTime,
                  slotIndex,
                );
                handleMultiDayScheduleUpdate(
                  0,
                  "endTime",
                  slot.endTime,
                  slotIndex,
                );
                handleMultiDayScheduleUpdate(
                  0,
                  "volunteers",
                  slot.volunteers,
                  slotIndex,
                );
              }
            });
          }
        } else {
          addMultiDayEvent();
          handleMultiDayScheduleUpdate(dayIndex, "date", day.date);
          if (Array.isArray(day.slots)) {
            day.slots.forEach((slot, slotIndex) => {
              if (slotIndex === 0) {
                handleMultiDayScheduleUpdate(
                  dayIndex,
                  "name",
                  slot.name || "",
                  0,
                );
                handleMultiDayScheduleUpdate(
                  dayIndex,
                  "startTime",
                  slot.startTime,
                  0,
                );
                handleMultiDayScheduleUpdate(
                  dayIndex,
                  "endTime",
                  slot.endTime,
                  0,
                );
                handleMultiDayScheduleUpdate(
                  dayIndex,
                  "volunteers",
                  slot.volunteers,
                  0,
                );
              } else {
                addMultiDaySlot(dayIndex);
                handleMultiDayScheduleUpdate(
                  dayIndex,
                  "name",
                  slot.name || "",
                  slotIndex,
                );
                handleMultiDayScheduleUpdate(
                  dayIndex,
                  "startTime",
                  slot.startTime,
                  slotIndex,
                );
                handleMultiDayScheduleUpdate(
                  dayIndex,
                  "endTime",
                  slot.endTime,
                  slotIndex,
                );
                handleMultiDayScheduleUpdate(
                  dayIndex,
                  "volunteers",
                  slot.volunteers,
                  slotIndex,
                );
              }
            });
          }
        }
      });
    } else if (
      data.eventType === "sameDayMultiArea" &&
      (data.schedule as AIScheduleSameDay).date
    ) {
      const schedule = data.schedule as AIScheduleSameDay;
      handleMultiRoleScheduleUpdate("date", schedule.date);
      if (schedule.overallStart)
        handleMultiRoleScheduleUpdate("overallStart", schedule.overallStart);
      if (schedule.overallEnd)
        handleMultiRoleScheduleUpdate("overallEnd", schedule.overallEnd);

      // Clear existing roles
      const currentRoles = state.schedule.sameDayMultiArea.roles.length;
      for (let i = currentRoles - 1; i > 0; i--) {
        removeRole(i);
      }

      // Add new roles from AI
      if (Array.isArray(schedule.roles)) {
        schedule.roles.forEach((role, roleIndex) => {
          if (roleIndex === 0) {
            handleMultiRoleScheduleUpdate("name", role.name, 0);
            handleMultiRoleScheduleUpdate("startTime", role.startTime, 0);
            handleMultiRoleScheduleUpdate("endTime", role.endTime, 0);
            handleMultiRoleScheduleUpdate("volunteers", role.volunteers, 0);
          } else {
            addRole();
            handleMultiRoleScheduleUpdate("name", role.name, roleIndex);
            handleMultiRoleScheduleUpdate(
              "startTime",
              role.startTime,
              roleIndex,
            );
            handleMultiRoleScheduleUpdate("endTime", role.endTime, roleIndex);
            handleMultiRoleScheduleUpdate(
              "volunteers",
              role.volunteers,
              roleIndex,
            );
          }
        });
      }
    }
  }

  // Apply verification settings
  if (data.verificationMethod) {
    updateVerificationMethod(data.verificationMethod);
  }
  if (data.requireLogin !== undefined) {
    updateRequireLogin(data.requireLogin);
  }

  // Apply recurrence settings
  if (data.recurrence) {
    if (data.recurrence.enabled !== undefined) {
      updateRecurrence("enabled", data.recurrence.enabled);
    }
    if (data.recurrence.frequency) {
      updateRecurrence("frequency", data.recurrence.frequency);
    }
    if (data.recurrence.interval !== undefined) {
      updateRecurrence("interval", data.recurrence.interval);
    }
    if (data.recurrence.endType) {
      updateRecurrence("endType", data.recurrence.endType);
    }
    if (data.recurrence.endDate) {
      updateRecurrence("endDate", data.recurrence.endDate);
    }
    if (data.recurrence.endOccurrences !== undefined) {
      updateRecurrence("endOccurrences", data.recurrence.endOccurrences);
    }
    if (data.recurrence.weekdays) {
      updateRecurrence("weekdays", data.recurrence.weekdays);
    }
  }
}
