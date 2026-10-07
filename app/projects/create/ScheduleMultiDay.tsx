"use client";

import { Plus } from "lucide-react";
import type { ZodIssue } from "zod";

import { PlusIcon, useAnimatedIcon } from "@/components/icons/animated";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getMultiDaySlotDisplayName } from "@/utils/project";

import { FormGroup } from "./form-parts";
import {
  DateField,
  NameField,
  RemoveButton,
  TimeField,
  VolunteersField,
  getArrayError,
  getFieldError,
  isTimeInPast,
  isTimeRangeInvalid,
  type ScheduleState,
} from "./schedule-shared";

export function ScheduleMultiDay({
  days,
  updateMultiDayScheduleAction,
  addMultiDaySlotAction,
  addMultiDayEventAction,
  removeDayAction,
  removeSlotAction,
  errors,
}: {
  days: ScheduleState["schedule"]["multiDay"];
  updateMultiDayScheduleAction: (
    dayIndex: number,
    field: string,
    value: string | number,
    slotIndex?: number,
  ) => void;
  addMultiDaySlotAction: (dayIndex: number) => void;
  addMultiDayEventAction: () => void;
  removeDayAction: (dayIndex: number) => void;
  removeSlotAction: (dayIndex: number, slotIndex: number) => void;
  errors: ZodIssue[];
}) {
  const addDayIcon = useAnimatedIcon();

  return (
    <>
      {days.map((day, dayIndex) => {
        // Get day-specific errors (only for date field)
        const dateError = getFieldError(errors, `${dayIndex}.date`);

        return (
          <FormGroup
            key={dayIndex}
            title={`Day ${dayIndex + 1}`}
            aside={
              dayIndex > 0 ? (
                <RemoveButton
                  label={`Remove day ${dayIndex + 1}`}
                  onClick={() => removeDayAction(dayIndex)}
                />
              ) : null
            }
          >
            <DateField
              id={`multi-day-${dayIndex}-date`}
              label="Date"
              value={day.date}
              onChange={(date) =>
                updateMultiDayScheduleAction(dayIndex, "date", date)
              }
              error={dateError}
            />

            {day.slots.map((slot, slotIndex) => {
              const slotName = slot.name ?? "";
              const timeRangeInvalid = isTimeRangeInvalid(
                slot.startTime,
                slot.endTime,
              );
              const slotId = `multi-day-${dayIndex}-slot-${slotIndex}`;

              // Get slot-specific errors
              const basePath = `${dayIndex}.slots`;
              const nameError = getArrayError(
                errors,
                basePath,
                slotIndex,
                "name",
              );
              const startTimeError = getArrayError(
                errors,
                basePath,
                slotIndex,
                "startTime",
              );
              const endTimeError = getArrayError(
                errors,
                basePath,
                slotIndex,
                "endTime",
              );
              const volunteersError = getArrayError(
                errors,
                basePath,
                slotIndex,
                "volunteers",
              );
              const startInPast = isTimeInPast(day.date, slot.startTime);
              const endInPast = isTimeInPast(day.date, slot.endTime);

              return (
                <div
                  key={slotIndex}
                  className={cn(
                    "grid gap-4 rounded-lg border p-3 sm:p-4",
                    (nameError ||
                      startTimeError ||
                      endTimeError ||
                      volunteersError) &&
                      "border-destructive",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">
                      {getMultiDaySlotDisplayName(slot, slotIndex)}
                    </p>
                    {slotIndex > 0 && (
                      <RemoveButton
                        label={`Remove ${getMultiDaySlotDisplayName(slot, slotIndex)} from day ${dayIndex + 1}`}
                        onClick={() => removeSlotAction(dayIndex, slotIndex)}
                      />
                    )}
                  </div>
                  <NameField
                    id={`${slotId}-name`}
                    label="Slot name"
                    placeholder="Optional slot name (e.g., Morning Registration)"
                    value={slotName}
                    onChange={(value) =>
                      updateMultiDayScheduleAction(
                        dayIndex,
                        "name",
                        value,
                        slotIndex,
                      )
                    }
                    error={nameError}
                  />
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <TimeField
                      label="Start time"
                      value={slot.startTime}
                      onChange={(time) =>
                        updateMultiDayScheduleAction(
                          dayIndex,
                          "startTime",
                          time,
                          slotIndex,
                        )
                      }
                      error={
                        timeRangeInvalid || startInPast || !!startTimeError
                      }
                      errorMessage={
                        startTimeError
                          ? startTimeError
                          : timeRangeInvalid
                            ? "Invalid time"
                            : startInPast
                              ? "Start time must be in the future"
                              : undefined
                      }
                    />
                    <TimeField
                      label="End time"
                      value={slot.endTime}
                      onChange={(time) =>
                        updateMultiDayScheduleAction(
                          dayIndex,
                          "endTime",
                          time,
                          slotIndex,
                        )
                      }
                      error={timeRangeInvalid || endInPast || !!endTimeError}
                      errorMessage={
                        endTimeError
                          ? endTimeError
                          : timeRangeInvalid
                            ? "Invalid time"
                            : endInPast
                              ? "End time must be in the future"
                              : undefined
                      }
                    />
                    <div className="col-span-2 sm:col-span-1">
                      <VolunteersField
                        id={`${slotId}-volunteers`}
                        label="Volunteers"
                        placeholder="# volunteers"
                        value={slot.volunteers}
                        onChange={(value) =>
                          updateMultiDayScheduleAction(
                            dayIndex,
                            "volunteers",
                            value,
                            slotIndex,
                          )
                        }
                        error={volunteersError}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            <Button
              type="button"
              variant="ghost"
              className="justify-self-start"
              onClick={() => addMultiDaySlotAction(dayIndex)}
            >
              <Plus data-icon="inline-start" aria-hidden="true" />
              Add time slot
            </Button>
          </FormGroup>
        );
      })}
      <FormGroup>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={addMultiDayEventAction}
          {...addDayIcon.triggerProps}
        >
          <PlusIcon
            ref={addDayIcon.ref}
            size={16}
            data-icon="inline-start"
            aria-hidden="true"
          />
          Add another day
        </Button>
      </FormGroup>
    </>
  );
}
