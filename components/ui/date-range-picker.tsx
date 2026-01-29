"use client";

import * as React from "react";
import { format, startOfDay, endOfDay, subDays, subMonths, startOfMonth, endOfMonth, startOfYear, endOfYear, addYears } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";

interface DateRangePickerProps {
  value?: DateRange | undefined;
  onChange?: (range: DateRange | undefined) => void;
  placeholder?: string;
  className?: string;
  align?: "start" | "center" | "end";
  showQuickSelect?: boolean;
}

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function DateRangePicker({
  value,
  onChange,
  placeholder = "Select date range",
  className,
  align = "start",
  showQuickSelect = false
}: DateRangePickerProps) {
  const isMobile = useIsMobile();

  // Handle the date range selection
  const handleSelect = (range: DateRange | undefined) => {
    onChange?.(range);
  };

  const handleQuickSelect = (val: string | null) => {
    if (!val) return;

    const now = new Date();
    let from: Date | undefined;
    let to: Date | undefined;

    switch (val) {
      case "academic-year":
        // Academic year: August 1st to July 31st
        const currentYear = now.getFullYear();
        const academicStartYear = now.getMonth() >= 7 ? currentYear : currentYear - 1;
        from = new Date(academicStartYear, 7, 1); // Aug 1
        to = new Date(academicStartYear + 1, 6, 31); // July 31
        break;
      case "academic-semester":
        const currentMonth = now.getMonth();
        if (currentMonth >= 7) { // Fall: Aug - Dec
          from = new Date(now.getFullYear(), 7, 1);
          to = new Date(now.getFullYear(), 11, 31);
        } else { // Spring: Jan - May
          from = new Date(now.getFullYear(), 0, 1);
          to = new Date(now.getFullYear(), 4, 31);
        }
        break;
      case "summer":
        // Summer: June 1st - August 31st
        from = new Date(now.getFullYear(), 5, 1);
        to = new Date(now.getFullYear(), 7, 31);
        break;
      case "last-month":
        const startLastMonth = startOfMonth(subMonths(now, 1));
        from = startLastMonth;
        to = endOfMonth(subMonths(now, 1));
        break;
      case "last-6-months":
        from = subMonths(now, 6);
        to = now;
        break;
      case "lifetime":
        from = new Date(2020, 0, 1);
        to = now;
        break;
      default:
        break;
    }

    if (from && to) {
      onChange?.({ from, to });
    }
  };

  // Helper to determine which preset matches the current range
  const getSelectedPreset = (): string => {
    if (!value?.from || !value?.to) return "";

    const encodeDate = (d: Date) => format(d, 'yyyy-MM-dd');
    const vFrom = encodeDate(value.from);
    const vTo = encodeDate(value.to);

    const check = (f: Date, t: Date) => vFrom === encodeDate(f) && vTo === encodeDate(t);

    const now = new Date();
    const currentYear = now.getFullYear();

    // Check Academic Year
    const academicStartYear = now.getMonth() >= 7 ? currentYear : currentYear - 1;
    if (check(new Date(academicStartYear, 7, 1), new Date(academicStartYear + 1, 6, 31))) return "academic-year";

    // Semester
    if (now.getMonth() >= 7) {
      if (check(new Date(currentYear, 7, 1), new Date(currentYear, 11, 31))) return "academic-semester";
    } else {
      if (check(new Date(currentYear, 0, 1), new Date(currentYear, 4, 31))) return "academic-semester";
    }

    // Summer
    if (check(new Date(currentYear, 5, 1), new Date(currentYear, 7, 31))) return "summer";

    // Last Month
    if (check(startOfMonth(subMonths(now, 1)), endOfMonth(subMonths(now, 1)))) return "last-month";

    return "";
  };

  const selectedPreset = getSelectedPreset();

  return (
    <div className={cn("flex flex-col sm:flex-row gap-2 w-full", className)}>
      {showQuickSelect && (
        <Select value={selectedPreset} onValueChange={handleQuickSelect}>
          <SelectTrigger className="w-full sm:w-[200px] h-9">
            <SelectValue placeholder="Quick select">
              {selectedPreset === "academic-year" ? "This Academic Year" :
                selectedPreset === "academic-semester" ? "This Academic Semester" :
                  selectedPreset === "summer" ? "Summer" :
                    selectedPreset === "last-month" ? "Last Month" :
                      selectedPreset === "last-6-months" ? "Last 6 Months" :
                        selectedPreset === "lifetime" ? "Lifetime" :
                          "Quick select"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="academic-year">This Academic Year</SelectItem>
            <SelectItem value="academic-semester">This Academic Semester</SelectItem>
            <SelectItem value="summer">Summer</SelectItem>
            <SelectItem value="last-month">Last Month</SelectItem>
            <SelectItem value="last-6-months">Last 6 Months</SelectItem>
            <SelectItem value="lifetime">Lifetime</SelectItem>
          </SelectContent>
        </Select>
      )}
      <Popover>
        <PopoverTrigger
          render={
            <Button
              id="date"
              variant={"outline"}
              className={cn(
                "justify-start text-left font-normal flex-1 h-9",
                !value && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {value?.from ? (
                value.to && value.to.getTime() !== value.from.getTime() ? (
                  <>
                    {format(value.from, "MMM d")} -{" "}
                    {format(value.to, "MMM d")}
                  </>
                ) : (
                  format(value.from, "MMM d")
                )
              ) : (
                <span>{placeholder}</span>
              )}
            </Button>
          }
        />
        <PopoverContent className="w-auto p-0" align={align}>
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={value?.from}
            selected={value}
            onSelect={handleSelect}
            numberOfMonths={isMobile ? 1 : 2}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}