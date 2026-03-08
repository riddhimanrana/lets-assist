"use client";

import * as React from "react";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface DatePickerProps {
  value?: string; // YYYY-MM-DD format
  onChange?: (value: string) => void;
  minDate?: string; // YYYY-MM-DD format
  maxDate?: string; // YYYY-MM-DD format
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  error?: boolean;
  "data-testid"?: string;
}

export function DatePicker({
  value,
  onChange,
  minDate,
  maxDate,
  placeholder = "Pick a date",
  disabled = false,
  className,
  error = false,
  "data-testid": dataTestId,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  
  // Convert string date (YYYY-MM-DD) to Date object (local time, date-only)
  const selectedDate = value ? new Date(`${value}T00:00:00`) : undefined;
  
  // Parse min/max dates
  const minDateObj = minDate ? new Date(`${minDate}T00:00:00`) : undefined;
  const maxDateObj = maxDate ? new Date(`${maxDate}T00:00:00`) : undefined;

  // Prefer opening the calendar near a meaningful month.
  const defaultMonth = selectedDate ?? minDateObj ?? maxDateObj;

  // Format date for display (stable formatting)
  const displayValue = selectedDate ? format(selectedDate, "MMMM d, yyyy") : placeholder;

  const handleSelect = (date: Date | undefined) => {
    if (date && onChange) {
      // Convert Date to YYYY-MM-DD format
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateString = `${year}-${month}-${day}`;
      onChange(dateString);
    }
    setOpen(false);
  };

  // Create disabled matcher for dates outside min/max range
  const disabledDateMatcher = React.useMemo(() => {
    return (date: Date): boolean => {
      if (minDateObj && date < minDateObj) {
        return true;
      }
      if (maxDateObj && date > maxDateObj) {
        return true;
      }
      return false;
    };
  }, [minDateObj, maxDateObj]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal",
              !value && "text-muted-foreground",
              error && "border-destructive focus-visible:ring-destructive",
              className
            )}
            disabled={disabled}
            data-testid={dataTestId}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {displayValue}
          </Button>
        }
      />
      <PopoverContent className="w-auto p-0" align="start">
        {/* Quick action: Today button */}
        <div className="border-b p-2 bg-muted/50">
          <Button
            size="sm"
            variant="ghost"
            className="w-full justify-start text-xs"
            onClick={() => {
              const today = new Date();
              // Check if today is within the valid date range
              if (!disabledDateMatcher(today)) {
                handleSelect(today);
              }
            }}
          >
            Today
          </Button>
        </div>
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={handleSelect}
          disabled={disabledDateMatcher}
          defaultMonth={defaultMonth}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
