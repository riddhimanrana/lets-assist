"use client";

import type { ZodIssue } from "zod";

import type { RecurrenceFieldErrors } from "@/lib/projects/recurrence";

import { StepSection } from "./form-parts";
import RecurrenceSettings from "./RecurrenceSettings";
import { ScheduleMultiDay } from "./ScheduleMultiDay";
import { ScheduleMultiRole } from "./ScheduleMultiRole";
import { ScheduleOneTime } from "./ScheduleOneTime";
import type { ScheduleState } from "./schedule-shared";

interface ScheduleProps {
  state: ScheduleState;
  updateOneTimeScheduleAction: (
    field: keyof ScheduleProps["state"]["schedule"]["oneTime"],
    value: string | number,
  ) => void;
  updateMultiDayScheduleAction: (
    dayIndex: number,
    field: string,
    value: string | number,
    slotIndex?: number,
  ) => void;
  updateMultiRoleScheduleAction: (
    field: string,
    value: string | number,
    roleIndex?: number,
  ) => void;
  addMultiDaySlotAction: (dayIndex: number) => void;
  addMultiDayEventAction: () => void;
  addRoleAction: () => void;
  removeDayAction: (dayIndex: number) => void;
  removeSlotAction: (dayIndex: number, slotIndex: number) => void;
  removeRoleAction: (roleIndex: number) => void;
  updateRecurrenceAction?: (
    field: keyof ScheduleProps["state"]["recurrence"],
    value: ScheduleProps["state"]["recurrence"][keyof ScheduleProps["state"]["recurrence"]],
  ) => void;
  errors?: ZodIssue[];
  /** The project's timezone, which decides whether a time has passed. */
  projectTimezone?: string;
  recurrenceErrors?: RecurrenceFieldErrors;
  /** True when the project requires a waiver, which each new event copies. */
  recurrenceWaiverRequired?: boolean;
}

export default function Schedule({
  state,
  updateOneTimeScheduleAction,
  updateMultiDayScheduleAction,
  updateMultiRoleScheduleAction,
  addMultiDaySlotAction,
  addMultiDayEventAction,
  addRoleAction,
  removeDayAction,
  removeSlotAction,
  removeRoleAction,
  updateRecurrenceAction,
  errors = [],
  projectTimezone,
  recurrenceErrors,
  recurrenceWaiverRequired,
}: ScheduleProps) {
  if (state.eventType === "oneTime") {
    return (
      <StepSection
        title="Schedule your event"
        description="Pick a date and time for your event"
      >
        <ScheduleOneTime
          oneTime={state.schedule.oneTime}
          updateOneTimeScheduleAction={updateOneTimeScheduleAction}
          errors={errors}
          timeZone={projectTimezone}
        />
        {/* Recurrence Settings for oneTime events */}
        {updateRecurrenceAction && (
          <RecurrenceSettings
            recurrence={state.recurrence}
            updateRecurrence={updateRecurrenceAction}
            eventType={state.eventType}
            errors={recurrenceErrors}
            waiverRequired={recurrenceWaiverRequired}
          />
        )}
      </StepSection>
    );
  }

  if (state.eventType === "multiDay") {
    return (
      <StepSection
        title="Schedule your event"
        description="Set up your event schedule across multiple days"
      >
        <ScheduleMultiDay
          days={state.schedule.multiDay}
          updateMultiDayScheduleAction={updateMultiDayScheduleAction}
          addMultiDaySlotAction={addMultiDaySlotAction}
          addMultiDayEventAction={addMultiDayEventAction}
          removeDayAction={removeDayAction}
          removeSlotAction={removeSlotAction}
          errors={errors}
          timeZone={projectTimezone}
        />
      </StepSection>
    );
  }

  if (state.eventType === "sameDayMultiArea") {
    return (
      <StepSection
        title="Schedule your event"
        description="Define different roles and timings for a single day event"
      >
        <ScheduleMultiRole
          sameDayMultiArea={state.schedule.sameDayMultiArea}
          updateMultiRoleScheduleAction={updateMultiRoleScheduleAction}
          addRoleAction={addRoleAction}
          removeRoleAction={removeRoleAction}
          errors={errors}
          timeZone={projectTimezone}
        />
        {/* Recurrence Settings for sameDayMultiArea events */}
        {updateRecurrenceAction && (
          <RecurrenceSettings
            recurrence={state.recurrence}
            updateRecurrence={updateRecurrenceAction}
            eventType={state.eventType}
            errors={recurrenceErrors}
            waiverRequired={recurrenceWaiverRequired}
          />
        )}
      </StepSection>
    );
  }

  return null;
}
