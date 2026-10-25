"use client";

import { Calendar as CalendarIcon, X } from "lucide-react";
import { format } from "date-fns";
import type { ZodIssue } from "zod";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TimePicker } from "@/components/ui/time-picker";
import { cn } from "@/lib/utils";
import { isDateTimeInPast } from "@/schemas/event-form-helpers";
import type {
  RecurrenceEndType,
  RecurrenceFrequency,
  RecurrenceWeekday,
} from "@/types";

import { FormField } from "./form-parts";

export interface ScheduleSlot {
  name: string;
  startTime: string;
  endTime: string;
  volunteers: number;
}

export interface ScheduleRecurrence {
  enabled: boolean;
  frequency: RecurrenceFrequency;
  interval: number;
  endType: RecurrenceEndType;
  endDate?: string;
  endOccurrences?: number;
  weekdays: RecurrenceWeekday[];
}

export interface ScheduleState {
  eventType: string;
  schedule: {
    oneTime: {
      date: string;
      startTime: string;
      endTime: string;
      volunteers: number;
    };
    multiDay: {
      date: string;
      slots: ScheduleSlot[];
    }[];
    sameDayMultiArea: {
      date: string;
      overallStart: string;
      overallEnd: string;
      roles: ScheduleSlot[];
    };
  };
  recurrence: ScheduleRecurrence;
}

// Helper function to ensure dates are handled consistently without timezone shifting
export const formatDateToString = (date: Date | undefined): string => {
  if (!date) return "";
  // Create new date with just the year, month, and day components to avoid timezone issues
  return format(
    new Date(date.getFullYear(), date.getMonth(), date.getDate()),
    "yyyy-MM-dd",
  );
};

// Helper function to parse date string to Date object without timezone shifting
export const parseStringToDate = (dateString: string): Date | undefined => {
  if (!dateString) return undefined;
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day); // month is 0-indexed in JavaScript Date
};

export const isTimeRangeInvalid = (startTime: string, endTime: string) => {
  if (!startTime || !endTime) return false;
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  if (endHour < startHour) return true;
  if (endHour === startHour && endMinute <= startMinute) return true;
  return false;
};

// Add functions to validate dates and times
export const isPastDate = (date: Date) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
};

/** Whether a date and time, read in the project's timezone, has passed. */
export const isTimeInPast = (date: string, time: string, timeZone?: string) =>
  isDateTimeInPast(date, time, timeZone);

// Get field error from Zod issues
export const getFieldError = (
  errors: ZodIssue[],
  fieldPath: string,
): string | undefined => {
  const error = errors.find((issue) => {
    return (
      issue.path.join(".") === fieldPath ||
      issue.path.join(".").startsWith(fieldPath + "[") ||
      issue.path.join(".").startsWith(fieldPath + ".")
    );
  });
  return error?.message;
};

// Get array error from Zod issues for nested structures (slots, roles)
export const getArrayError = (
  errors: ZodIssue[],
  basePath: string,
  index: number,
  field: string,
): string | undefined => {
  const path = `${basePath}.${index}.${field}`;
  return getFieldError(errors, path);
};

/** A date picked from a calendar popover. Past dates are disabled. */
export function DateField({
  id,
  label,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (date: string) => void;
  error?: string;
}) {
  return (
    <FormField label={label} htmlFor={id} error={error}>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              id={id}
              variant="outline"
              aria-invalid={error ? true : undefined}
              className={cn(
                "w-full justify-start text-left font-normal",
                !value && "text-muted-foreground",
              )}
            >
              <CalendarIcon data-icon="inline-start" aria-hidden="true" />
              {value
                ? format(parseStringToDate(value) as Date, "MMM d, yyyy")
                : "Pick a date"}
            </Button>
          }
        />
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={parseStringToDate(value)}
            onSelect={(date) => {
              const newDate = formatDateToString(date);
              if (newDate !== value) {
                onChange(newDate);
              }
            }}
            disabled={isPastDate}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </FormField>
  );
}

/** A time input with its label above and its message below, like every other field. */
export function TimeField({
  label,
  value,
  onChange,
  error,
  errorMessage,
}: {
  label: string;
  value: string;
  onChange: (time: string) => void;
  error: boolean;
  errorMessage?: string;
}) {
  return (
    <FormField label={label} error={error ? errorMessage : undefined}>
      <TimePicker value={value} onChangeAction={onChange} error={error} />
    </FormField>
  );
}

export function VolunteersField({
  id,
  label,
  placeholder,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: number;
  onChange: (value: number) => void;
  error?: string;
}) {
  return (
    <FormField label={label} htmlFor={id} error={error}>
      <Input
        id={id}
        type="number"
        min="1"
        max="1000"
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        value={value || ""}
        onChange={(e) => {
          const value = parseInt(e.target.value);
          onChange(value);
        }}
      />
    </FormField>
  );
}

/** A slot or role name with its 75 character counter. */
export function NameField({
  id,
  label,
  placeholder,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <FormField
      label={label}
      htmlFor={id}
      hint={
        <span className="text-muted-foreground text-xs tabular-nums">
          {value.length}/75
        </span>
      }
      error={error}
    >
      <Input
        id={id}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          if (e.target.value.length <= 75) {
            onChange(e.target.value);
          }
        }}
        maxLength={75}
        aria-invalid={error ? true : undefined}
      />
    </FormField>
  );
}

export function RemoveButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      onClick={onClick}
      className="text-muted-foreground -my-1.5 shrink-0"
    >
      <X aria-hidden="true" />
    </Button>
  );
}
