"use client";

import * as React from "react";
import { format } from "date-fns";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DateRangePickerProps {
  value?: DateRange | undefined;
  onChange?: (range: DateRange | undefined) => void;
  placeholder?: string;
  className?: string;
  align?: "start" | "center" | "end";
  showQuickSelect?: boolean;
}

export function DateRangePicker({
  value,
  onChange,
  placeholder = "Select date range",
  className,
  align = "start",
  showQuickSelect = false
}: DateRangePickerProps) {
  // Handle the date range selection by adding a day to the end date
  const handleSelect = (range: DateRange | undefined) => {
    if (range?.to) {
      // Create a new end date and add one day
      const adjustedEndDate = new Date(range.to);
      adjustedEndDate.setDate(adjustedEndDate.getDate() + 1);
      // Create new range with adjusted end date
      onChange?.({ from: range.from, to: adjustedEndDate });
    } else {
      onChange?.(range);
    }
  };

  const handleQuickSelect = (value: string) => {
    const now = new Date()
    let startDate: Date
    
    switch (value) {
      case "academic-year":
        // Academic year: August 1st of current year to July 31st of next year
        // If we're past August, current academic year started this August
        // If we're before August, current academic year started last August
        const currentYear = now.getFullYear()
        const academicStartYear = now.getMonth() >= 7 ? currentYear : currentYear - 1 // August is month 7 (0-indexed)
        startDate = new Date(academicStartYear, 7, 1) // August 1st
        const endDate = new Date(academicStartYear + 1, 6, 31) // July 31st next year
        const adjustedEndDate = new Date(endDate)
        adjustedEndDate.setDate(adjustedEndDate.getDate() + 1)
        onChange?.({ from: startDate, to: adjustedEndDate })
        return
      case "academic-semester":
        // Fall semester: August - December, Spring semester: January - May
        const currentMonth = now.getMonth()
        if (currentMonth >= 7) { // August-December (Fall)
          startDate = new Date(now.getFullYear(), 7, 1) // August 1st
          const semesterEnd = new Date(now.getFullYear(), 11, 31) // December 31st
          const adjustedSemesterEnd = new Date(semesterEnd)
          adjustedSemesterEnd.setDate(adjustedSemesterEnd.getDate() + 1)
          onChange?.({ from: startDate, to: adjustedSemesterEnd })
        } else { // January-July (Spring)
          startDate = new Date(now.getFullYear(), 0, 1) // January 1st
          const semesterEnd = new Date(now.getFullYear(), 4, 31) // May 31st
          const adjustedSemesterEnd = new Date(semesterEnd)
          adjustedSemesterEnd.setDate(adjustedSemesterEnd.getDate() + 1)
          onChange?.({ from: startDate, to: adjustedSemesterEnd })
        }
        return
      case "summer":
        // Summer: June 1st - August 31st
        startDate = new Date(now.getFullYear(), 5, 1) // June 1st
        const summerEnd = new Date(now.getFullYear(), 7, 31) // August 31st
        const adjustedSummerEnd = new Date(summerEnd)
        adjustedSummerEnd.setDate(adjustedSummerEnd.getDate() + 1)
        onChange?.({ from: startDate, to: adjustedSummerEnd })
        return
      case "last-month":
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
        break
      case "last-6-months":
        startDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate())
        break
      case "lifetime":
        // Set a very early date instead of undefined
        startDate = new Date(2020, 0, 1) // January 1, 2020
        break
      default:
        startDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate())
        break
    }
    
    const adjustedEndDate = new Date(now);
    adjustedEndDate.setDate(adjustedEndDate.getDate() + 1);
    onChange?.({ from: startDate, to: adjustedEndDate })
  };

  // For display purposes, if we have an end date, subtract one day to show the actual selected date
  const displayRange = value && value.to ? {
    from: value.from,
    to: new Date(new Date(value.to).setDate(value.to.getDate() - 1))
  } : value;

  return (
    <div className={cn("flex flex-col sm:flex-row gap-2", className)}>
      {showQuickSelect && (
        <Select onValueChange={handleQuickSelect}>
          <SelectTrigger className="w-full sm:w-[140px] h-9">
            <SelectValue placeholder="Quick select" />
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
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant={"outline"}
            size="sm"
            className={cn(
              "justify-start text-left h-9",
              !value && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {displayRange?.from ? (
              displayRange.to ? (
                <>
                  {format(displayRange.from, "MMM d")} - {format(displayRange.to, "MMM d")}
                </>
              ) : (
                format(displayRange.from, "MMM d")
              )
            ) : (
              <span>Pick dates</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align={align}>
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={displayRange?.from}
            selected={displayRange}
            onSelect={handleSelect}
            numberOfMonths={1}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}