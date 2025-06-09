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
      case "last-week":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case "last-month":
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
        break
      case "last-3-months":
        startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())
        break
      case "last-6-months":
        startDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate())
        break
      case "last-year":
        startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
        break
      case "lifetime":
      default:
        onChange?.(undefined)
        return
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
            <SelectItem value="lifetime">Lifetime</SelectItem>
            <SelectItem value="last-week">Last week</SelectItem>
            <SelectItem value="last-month">Last month</SelectItem>
            <SelectItem value="last-3-months">Last 3 months</SelectItem>
            <SelectItem value="last-6-months">Last 6 months</SelectItem>
            <SelectItem value="last-year">Last year</SelectItem>
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