"use client";

import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  RecurrenceFrequency,
  RecurrenceEndType,
  RecurrenceWeekday,
} from "@/types";
import { RECURRENCE_OCCURRENCE_MAX } from "@/lib/projects/schedule-validation";
import {
  RECURRENCE_WAIVER_COPY_NOTICE,
  type RecurrenceFieldErrors,
} from "@/lib/projects/recurrence";
import { FieldError } from "@/components/ui/field";
import { FormField, FormGroup, ToggleRow } from "./form-parts";

interface RecurrenceSettingsProps {
  recurrence: {
    enabled: boolean;
    frequency: RecurrenceFrequency;
    interval: number;
    endType: RecurrenceEndType;
    endDate?: string;
    endOccurrences?: number;
    weekdays: RecurrenceWeekday[];
  };
  updateRecurrence: (
    field: keyof RecurrenceSettingsProps["recurrence"],
    value: RecurrenceSettingsProps["recurrence"][keyof RecurrenceSettingsProps["recurrence"]],
  ) => void;
  eventType: string;
  /** Field-level problems found when the step was validated. */
  errors?: RecurrenceFieldErrors;
  /** True when the project requires a waiver, which each new event copies. */
  waiverRequired?: boolean;
}

const WEEKDAYS: { value: RecurrenceWeekday; label: string; short: string }[] = [
  { value: "monday", label: "Monday", short: "Mon" },
  { value: "tuesday", label: "Tuesday", short: "Tue" },
  { value: "wednesday", label: "Wednesday", short: "Wed" },
  { value: "thursday", label: "Thursday", short: "Thu" },
  { value: "friday", label: "Friday", short: "Fri" },
  { value: "saturday", label: "Saturday", short: "Sat" },
  { value: "sunday", label: "Sunday", short: "Sun" },
];

export default function RecurrenceSettings({
  recurrence,
  updateRecurrence,
  eventType,
  errors = {},
  waiverRequired = false,
}: RecurrenceSettingsProps) {
  // Helper to parse date string to Date object without timezone shifting
  const parseStringToDate = (dateString: string): Date | undefined => {
    if (!dateString) return undefined;
    const [year, month, day] = dateString.split("-").map(Number);
    return new Date(year, month - 1, day);
  };

  // Helper to format Date to string
  const formatDateToString = (date: Date | undefined): string => {
    if (!date) return "";
    return format(
      new Date(date.getFullYear(), date.getMonth(), date.getDate()),
      "yyyy-MM-dd",
    );
  };

  const toggleWeekday = (day: RecurrenceWeekday) => {
    const currentWeekdays = recurrence.weekdays || [];
    if (currentWeekdays.includes(day)) {
      updateRecurrence(
        "weekdays",
        currentWeekdays.filter((d) => d !== day),
      );
    } else {
      updateRecurrence("weekdays", [...currentWeekdays, day]);
    }
  };

  const getFrequencyLabel = () => {
    const interval = recurrence.interval || 1;
    switch (recurrence.frequency) {
      case "daily":
        return interval === 1 ? "day" : `${interval} days`;
      case "weekly":
        return interval === 1 ? "week" : `${interval} weeks`;
      case "monthly":
        return interval === 1 ? "month" : `${interval} months`;
      case "yearly":
        return interval === 1 ? "year" : `${interval} years`;
      default:
        return "week";
    }
  };

  const getRecurrenceSummary = () => {
    if (!recurrence.enabled) return null;

    let summary = `Repeats every ${getFrequencyLabel()}`;

    if (recurrence.frequency === "weekly" && recurrence.weekdays.length > 0) {
      const dayNames = recurrence.weekdays
        .map((d) => WEEKDAYS.find((w) => w.value === d)?.short)
        .filter(Boolean)
        .join(", ");
      summary += ` on ${dayNames}`;
    }

    if (recurrence.endType === "on_date" && recurrence.endDate) {
      summary += ` until ${format(parseStringToDate(recurrence.endDate)!, "MMM d, yyyy")}`;
    } else if (
      recurrence.endType === "after_occurrences" &&
      recurrence.endOccurrences
    ) {
      summary += `, ${recurrence.endOccurrences} times`;
    }

    return summary;
  };

  // Don't show for multiDay events (too complex)
  if (eventType === "multiDay") {
    return null;
  }

  const frequencyOptions: Record<string, string> = {
    daily: "Day(s)",
    weekly: "Week(s)",
    monthly: "Month(s)",
    yearly: "Year(s)",
  };

  const endTypeOptions: Record<string, string> = {
    never: "Never (ongoing)",
    on_date: "On a specific date",
    after_occurrences: "After # occurrences",
  };

  return (
    <FormGroup>
      <ToggleRow
        id="recurrence-enabled"
        label="Recurring event"
        description={
          recurrence.enabled
            ? getRecurrenceSummary()
            : "Set up this event to repeat automatically. New events will be created based on your schedule."
        }
        checked={recurrence.enabled}
        onCheckedChange={(checked) => updateRecurrence("enabled", checked)}
      />
      {errors.enabled ? <FieldError>{errors.enabled}</FieldError> : null}
      {recurrence.enabled && waiverRequired ? (
        <p className="text-muted-foreground text-sm">
          {RECURRENCE_WAIVER_COPY_NOTICE}
        </p>
      ) : null}

      {recurrence.enabled && (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            {/* Frequency and Interval */}
            <FormField
              label="Repeat every"
              htmlFor="recurrence-interval"
              error={errors.interval}
            >
              <div className="flex gap-2">
                <Input
                  id="recurrence-interval"
                  type="number"
                  min="1"
                  max="99"
                  aria-invalid={errors.interval ? true : undefined}
                  value={recurrence.interval || 1}
                  onChange={(e) =>
                    updateRecurrence("interval", parseInt(e.target.value) || 1)
                  }
                  className="w-20"
                />
                <Select
                  value={recurrence.frequency}
                  onValueChange={(value) =>
                    updateRecurrence("frequency", value as RecurrenceFrequency)
                  }
                >
                  <SelectTrigger
                    aria-label="Repeat frequency"
                    className="flex-1"
                  >
                    <SelectValue>
                      {frequencyOptions[recurrence.frequency] ||
                        recurrence.frequency}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Day(s)</SelectItem>
                    <SelectItem value="weekly">Week(s)</SelectItem>
                    <SelectItem value="monthly">Month(s)</SelectItem>
                    <SelectItem value="yearly">Year(s)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </FormField>

            {/* End condition */}
            <FormField label="Ends" htmlFor="recurrence-end-type">
              <Select
                value={recurrence.endType}
                onValueChange={(value) =>
                  updateRecurrence("endType", value as RecurrenceEndType)
                }
              >
                <SelectTrigger id="recurrence-end-type" className="w-full">
                  <SelectValue>
                    {endTypeOptions[recurrence.endType] || recurrence.endType}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">Never (ongoing)</SelectItem>
                  <SelectItem value="on_date">On a specific date</SelectItem>
                  <SelectItem value="after_occurrences">
                    After # occurrences
                  </SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </div>

          {/* Weekday selection for weekly recurrence */}
          {recurrence.frequency === "weekly" && (
            <FormField
              label="Repeat on"
              error={
                errors.weekdays ??
                (recurrence.weekdays.length === 0
                  ? "Select at least one day"
                  : undefined)
              }
            >
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((day) => (
                  <Button
                    key={day.value}
                    type="button"
                    variant={
                      recurrence.weekdays.includes(day.value)
                        ? "default"
                        : "outline"
                    }
                    aria-pressed={recurrence.weekdays.includes(day.value)}
                    aria-label={day.label}
                    onClick={() => toggleWeekday(day.value)}
                    className={cn(
                      "min-w-12 flex-1",
                      !recurrence.weekdays.includes(day.value) &&
                        "text-muted-foreground",
                    )}
                  >
                    {day.short}
                  </Button>
                ))}
              </div>
            </FormField>
          )}

          {/* End date picker */}
          {recurrence.endType === "on_date" && (
            <FormField
              label="End date"
              htmlFor="recurrence-end-date"
              error={errors.endDate}
            >
              <Popover>
                <PopoverTrigger
                  render={
                    <Button
                      id="recurrence-end-date"
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !recurrence.endDate && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon
                        data-icon="inline-start"
                        aria-hidden="true"
                      />
                      {recurrence.endDate
                        ? format(
                            parseStringToDate(recurrence.endDate)!,
                            "MMM d, yyyy",
                          )
                        : "Pick an end date"}
                    </Button>
                  }
                />
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={parseStringToDate(recurrence.endDate || "")}
                    onSelect={(date) =>
                      updateRecurrence("endDate", formatDateToString(date))
                    }
                    disabled={(date) => date < new Date()}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </FormField>
          )}

          {/* Number of occurrences */}
          {recurrence.endType === "after_occurrences" && (
            <FormField
              label="Total occurrences"
              htmlFor="recurrence-end-occurrences"
              error={errors.endOccurrences}
            >
              <div className="flex items-center gap-3">
                <Input
                  id="recurrence-end-occurrences"
                  type="number"
                  min="2"
                  max={RECURRENCE_OCCURRENCE_MAX}
                  placeholder="e.g., 10"
                  value={recurrence.endOccurrences || ""}
                  onChange={(e) =>
                    updateRecurrence(
                      "endOccurrences",
                      parseInt(e.target.value) || undefined,
                    )
                  }
                  className="w-24"
                />
                <span className="text-muted-foreground text-sm">
                  events total
                </span>
              </div>
            </FormField>
          )}

          {/* Info banner */}
          <Alert variant="info">
            <AlertTitle>How repeating works</AlertTitle>
            <AlertDescription>
              <ul className="list-inside list-disc">
                <li>
                  Future events are automatically created based on your schedule
                </li>
                <li>Each occurrence can be edited individually</li>
                <li>Events are generated up to 4 weeks in advance</li>
              </ul>
            </AlertDescription>
          </Alert>
        </>
      )}
    </FormGroup>
  );
}
