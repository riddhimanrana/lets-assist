"use client";

import type { ZodIssue } from "zod";

import { FormGroup } from "./form-parts";
import {
  DateField,
  TimeField,
  VolunteersField,
  getFieldError,
  isTimeInPast,
  isTimeRangeInvalid,
  type ScheduleState,
} from "./schedule-shared";

export function ScheduleOneTime({
  oneTime,
  updateOneTimeScheduleAction,
  errors,
}: {
  oneTime: ScheduleState["schedule"]["oneTime"];
  updateOneTimeScheduleAction: (
    field: keyof ScheduleState["schedule"]["oneTime"],
    value: string | number,
  ) => void;
  errors: ZodIssue[];
}) {
  const timeRangeInvalid = isTimeRangeInvalid(
    oneTime.startTime,
    oneTime.endTime,
  );

  // Get specific errors for oneTime fields
  const dateError = getFieldError(errors, "date");
  const startTimeError = getFieldError(errors, "startTime");
  const endTimeError = getFieldError(errors, "endTime");
  const volunteersError = getFieldError(errors, "volunteers");

  const startInPast = isTimeInPast(oneTime.date, oneTime.startTime);
  const endInPast = isTimeInPast(oneTime.date, oneTime.endTime);

  return (
    <FormGroup title="Date and time">
      <div className="grid gap-5 sm:grid-cols-2">
        <DateField
          id="one-time-date"
          label="Event date"
          value={oneTime.date}
          onChange={(date) => updateOneTimeScheduleAction("date", date)}
          error={dateError}
        />
        <VolunteersField
          id="one-time-volunteers"
          label="Volunteers needed"
          placeholder="Enter number of volunteers"
          value={oneTime.volunteers}
          onChange={(value) => updateOneTimeScheduleAction("volunteers", value)}
          error={volunteersError}
        />
        <TimeField
          label="Start time"
          value={oneTime.startTime}
          onChange={(time) => updateOneTimeScheduleAction("startTime", time)}
          error={timeRangeInvalid || startInPast || !!startTimeError}
          errorMessage={
            startTimeError
              ? startTimeError
              : timeRangeInvalid
                ? "Start time must be before end time"
                : startInPast
                  ? "Start time must be in the future"
                  : undefined
          }
        />
        <TimeField
          label="End time"
          value={oneTime.endTime}
          onChange={(time) => updateOneTimeScheduleAction("endTime", time)}
          error={timeRangeInvalid || endInPast || !!endTimeError}
          errorMessage={
            endTimeError
              ? endTimeError
              : timeRangeInvalid
                ? "End time must be after start time"
                : endInPast
                  ? "End time must be in the future"
                  : undefined
          }
        />
      </div>
    </FormGroup>
  );
}
