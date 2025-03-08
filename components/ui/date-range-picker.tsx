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

interface DateRangePickerProps {
  value?: DateRange | undefined;
  onChange?: (range: DateRange | undefined) => void;
  placeholder?: string;
  className?: string;
  align?: "start" | "center" | "end";
}

export function DateRangePicker({
  value,
  onChange,
  placeholder = "Select date range",
  className,
  align = "start"
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

  // For display purposes, if we have an end date, subtract one day to show the actual selected date
  const displayRange = value && value.to ? {
    from: value.from,
    to: new Date(new Date(value.to).setDate(value.to.getDate() - 1))
  } : value;

  return (
    <div className={cn("grid gap-2", className)}>
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