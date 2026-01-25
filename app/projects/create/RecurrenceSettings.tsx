"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import { Calendar as CalendarIcon, Repeat, Info } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  RecurrenceFrequency,
  RecurrenceEndType,
  RecurrenceWeekday
} from "@/types";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
    value: RecurrenceSettingsProps["recurrence"][keyof RecurrenceSettingsProps["recurrence"]]
  ) => void;
  eventType: string;
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
}: RecurrenceSettingsProps) {
  // Helper to parse date string to Date object without timezone shifting
  const parseStringToDate = (dateString: string): Date | undefined => {
    if (!dateString) return undefined;
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day);
  };

  // Helper to format Date to string
  const formatDateToString = (date: Date | undefined): string => {
    if (!date) return "";
    return format(new Date(date.getFullYear(), date.getMonth(), date.getDate()), "yyyy-MM-dd");
  };

  const toggleWeekday = (day: RecurrenceWeekday) => {
    const currentWeekdays = recurrence.weekdays || [];
    if (currentWeekdays.includes(day)) {
      updateRecurrence("weekdays", currentWeekdays.filter((d) => d !== day));
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
    } else if (recurrence.endType === "after_occurrences" && recurrence.endOccurrences) {
      summary += `, ${recurrence.endOccurrences} times`;
    }

    return summary;
  };

  // Don't show for multiDay events (too complex)
  if (eventType === "multiDay") {
    return null;
  }

  return (
    <Card className="mt-6">
      <CardHeader className="">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Repeat className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Recurring Event</CardTitle>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>
                    Set up this event to repeat automatically. New events will be
                    created based on your schedule (e.g., every Friday).
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Switch
            checked={recurrence.enabled}
            onCheckedChange={(checked) => updateRecurrence("enabled", checked)}
          />
        </div>
        {recurrence.enabled && (
          <p className="text-sm text-muted-foreground mt-1">
            {getRecurrenceSummary()}
          </p>
        )}
      </CardHeader>

      {recurrence.enabled && (
        <CardContent className="space-y-6">
          {/* Frequency and Interval */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label>Repeat every</Label>
              <div className="flex gap-2 mt-1.5">
                <Input
                  type="number"
                  min="1"
                  max="99"
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
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Day(s)</SelectItem>
                    <SelectItem value="weekly">Week(s)</SelectItem>
                    <SelectItem value="monthly">Month(s)</SelectItem>
                    <SelectItem value="yearly">Year(s)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* End condition */}
            <div>
              <Label>Ends</Label>
              <Select
                value={recurrence.endType}
                onValueChange={(value) =>
                  updateRecurrence("endType", value as RecurrenceEndType)
                }
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">Never (ongoing)</SelectItem>
                  <SelectItem value="on_date">On a specific date</SelectItem>
                  <SelectItem value="after_occurrences">
                    After # occurrences
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Weekday selection for weekly recurrence */}
          {recurrence.frequency === "weekly" && (
            <div>
              <Label className="mb-2 block">Repeat on</Label>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((day) => (
                  <Button
                    key={day.value}
                    type="button"
                    variant={
                      recurrence.weekdays.includes(day.value)
                        ? "default"
                        : "outline-solid"
                    }
                    size="sm"
                    onClick={() => toggleWeekday(day.value)}
                    className="min-w-[60px]"
                  >
                    {day.short}
                  </Button>
                ))}
              </div>
              {recurrence.weekdays.length === 0 && (
                <p className="text-sm text-muted-foreground mt-2">
                  Select at least one day for weekly recurrence
                </p>
              )}
            </div>
          )}

          {/* End date picker */}
          {recurrence.endType === "on_date" && (
            <div>
              <Label>End date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal mt-1.5",
                      !recurrence.endDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {recurrence.endDate
                      ? format(parseStringToDate(recurrence.endDate)!, "PPP")
                      : "Pick an end date"}
                  </Button>
                </PopoverTrigger>
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
            </div>
          )}

          {/* Number of occurrences */}
          {recurrence.endType === "after_occurrences" && (
            <div>
              <Label>Number of occurrences</Label>
              <Input
                type="number"
                min="2"
                max="52"
                placeholder="e.g., 10"
                value={recurrence.endOccurrences || ""}
                onChange={(e) =>
                  updateRecurrence(
                    "endOccurrences",
                    parseInt(e.target.value) || undefined
                  )
                }
                className="mt-1.5 max-w-[150px]"
              />
              <p className="text-sm text-muted-foreground mt-1">
                Including this event
              </p>
            </div>
          )}

          {/* Info banner */}
          <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-1">How it works:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Future events are automatically created based on your schedule</li>
              <li>Each occurrence is a separate project that can be edited individually</li>
              <li>Events are generated up to 4 weeks in advance</li>
              {recurrence.endType === "never" && (
                <li>New events will keep being created until you stop the recurrence</li>
              )}
            </ul>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
