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
import { Calendar as CalendarIcon, Repeat, Info, AlertCircle, Sparkles } from "lucide-react";
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

  const frequencyOptions: Record<string, string> = {
    "daily": "Day(s)",
    "weekly": "Week(s)",
    "monthly": "Month(s)",
    "yearly": "Year(s)"
  };

  const endTypeOptions: Record<string, string> = {
    "never": "Never (ongoing)",
    "on_date": "On a specific date",
    "after_occurrences": "After # occurrences"
  };

  return (
    <Card className="mt-6 border-muted bg-muted/5 shadow-sm">
      <CardHeader className="cursor-pointer" onClick={() => updateRecurrence("enabled", !recurrence.enabled)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Repeat className={cn("h-5 w-5", recurrence.enabled ? "text-primary" : "text-muted-foreground")} />
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-medium">Recurring Event</CardTitle>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger render={
                      <button type="button" onClick={(e) => e.stopPropagation()}>
                        <Info className="h-4 w-4 text-muted-foreground/70 hover:text-muted-foreground transition-colors" />
                      </button>
                    } />
                    <TooltipContent className="max-w-xs">
                      <p>
                        Set up this event to repeat automatically. New events will be
                        created based on your schedule.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              {recurrence.enabled && (
                <p className="text-sm text-muted-foreground font-normal">
                  {getRecurrenceSummary()}
                </p>
              )}
            </div>
          </div>
          <Switch
            checked={recurrence.enabled}
            onCheckedChange={(checked) => updateRecurrence("enabled", checked)}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </CardHeader>

      {recurrence.enabled && (
        <CardContent className="space-y-6 pt-0 animate-in slide-in-from-top-2 fade-in duration-200">
          <div className="grid gap-6 sm:grid-cols-2">
            {/* Frequency and Interval */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Repeat every</Label>
              <div className="flex gap-3">
                <Input
                  type="number"
                  min="1"
                  max="99"
                  value={recurrence.interval || 1}
                  onChange={(e) =>
                    updateRecurrence("interval", parseInt(e.target.value) || 1)
                  }
                  className="w-20 bg-background"
                />
                <Select
                  value={recurrence.frequency}
                  onValueChange={(value) =>
                    updateRecurrence("frequency", value as RecurrenceFrequency)
                  }
                >
                  <SelectTrigger className="flex-1 bg-background">
                    <SelectValue>
                      {frequencyOptions[recurrence.frequency] || recurrence.frequency}
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
            </div>

            {/* End condition */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Ends</Label>
              <Select
                value={recurrence.endType}
                onValueChange={(value) =>
                  updateRecurrence("endType", value as RecurrenceEndType)
                }
              >
                <SelectTrigger className="bg-background">
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
            </div>
          </div>

          {/* Weekday selection for weekly recurrence */}
          {recurrence.frequency === "weekly" && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Repeat on</Label>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((day) => (
                  <Button
                    key={day.value}
                    type="button"
                    variant={recurrence.weekdays.includes(day.value) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleWeekday(day.value)}
                    className={cn(
                      "flex-1 min-w-[3rem] h-9 transition-all text-xs sm:text-sm",
                      recurrence.weekdays.includes(day.value)
                        ? "shadow-md hover:opacity-90"
                        : "hover:bg-accent hover:text-accent-foreground bg-background text-muted-foreground"
                    )}
                  >
                    {day.short}
                  </Button>
                ))}
              </div>
              {recurrence.weekdays.length === 0 && (
                <p className="text-xs text-destructive flex items-center gap-1.5 mt-1.5">
                  <AlertCircle className="h-3 w-3" />
                  Select at least one day
                </p>
              )}
            </div>
          )}

          {/* End date picker */}
          {recurrence.endType === "on_date" && (
            <div className="space-y-2 animate-in fade-in zoom-in-95 duration-200">
              <Label className="text-sm font-medium">End date</Label>
              <Popover>
                <PopoverTrigger render={
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal bg-background",
                      !recurrence.endDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {recurrence.endDate
                      ? format(parseStringToDate(recurrence.endDate)!, "PPP")
                      : "Pick an end date"}
                  </Button>
                } />
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
            <div className="space-y-2 animate-in fade-in zoom-in-95 duration-200">
              <Label className="text-sm font-medium">Total occurrences</Label>
              <div className="flex items-center gap-3">
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
                  className="w-24 bg-background"
                />
                <span className="text-sm text-muted-foreground">
                  events total
                </span>
              </div>
            </div>
          )}

          {/* Info banner */}
          <div className="bg-primary/5 text-primary/80 border border-primary/10 rounded-lg p-4 text-sm">
            <p className="font-semibold mb-2 flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              How resizing works
            </p>
            <ul className="list-disc list-inside space-y-1 opacity-90">
              <li>Future events are automatically created based on your schedule</li>
              <li>Each occurrence can be edited individually</li>
              <li>Events are generated up to 4 weeks in advance</li>
            </ul>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
