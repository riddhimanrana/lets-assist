"use client";

import * as React from "react";
import { CalendarIcon, Check, X } from "lucide-react";
import { format } from "date-fns";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

interface DateTimePickerProps {
  value?: Date | null;
  onChange?: (date: Date | null) => void;
  clearable?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export function DateTimePicker({
  value,
  onChange,
  clearable = true,
  disabled = false,
  placeholder = "MM/DD/YYYY hh:mm aa",
}: DateTimePickerProps) {
  // Use value from props if provided, otherwise use internal state
  const [date, setDate] = React.useState<Date | null>(value || null);
  const [isOpen, setIsOpen] = React.useState(false);

  // Update internal state when value prop changes
  React.useEffect(() => {
    if (value !== undefined) {
      setDate(value);
    }
  }, [value]);

  const hours = Array.from({ length: 12 }, (_, i) => i + 1);
  const minutes = Array.from({ length: 12 }, (_, i) => i * 5);

  const handleDateSelect = (selectedDate: Date | undefined) => {
    let newDate: Date | null = null;

    if (selectedDate) {
      // If we already have a date with time, keep the time
      if (date) {
        newDate = new Date(selectedDate);
        newDate.setHours(date.getHours(), date.getMinutes());
      } else {
        // If we don't have a date yet, set it to noon
        newDate = new Date(selectedDate);
        newDate.setHours(12, 0, 0, 0);
      }

      setDate(newDate);

      // If we're controlled, call the onChange prop
      if (onChange) {
        onChange(newDate);
      }
    }
  };

  const handleTimeChange = (
    type: "hour" | "minute" | "ampm",
    value: string
  ) => {
    if (date) {
      const newDate = new Date(date);

      if (type === "hour") {
        newDate.setHours(
          (parseInt(value) % 12) + (newDate.getHours() >= 12 ? 12 : 0)
        );
      } else if (type === "minute") {
        newDate.setMinutes(parseInt(value));
      } else if (type === "ampm") {
        const currentHours = newDate.getHours();
        const isPM = value === "PM";

        if (isPM && currentHours < 12) {
          newDate.setHours(currentHours + 12);
        } else if (!isPM && currentHours >= 12) {
          newDate.setHours(currentHours - 12);
        }
      }

      setDate(newDate);

      // If we're controlled, call the onChange prop
      if (onChange) {
        onChange(newDate);
      }
    }
  };

  const handleClear = () => {
    setDate(null);
    setIsOpen(false);

    // If we're controlled, call the onChange prop
    if (onChange) {
      onChange(null);
    }
  };

  const handleDone = () => {
    setIsOpen(false);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal",
            !date && "text-muted-foreground"
          )}
          disabled={disabled}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? (
            format(date, "MM/dd/yyyy hh:mm aa")
          ) : (
            <span>{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <div className="sm:flex">
          <Calendar
            mode="single"
            selected={date || undefined}
            onSelect={handleDateSelect}
            initialFocus
          />
          <div className="flex flex-col sm:flex-row sm:h-[300px] divide-y sm:divide-y-0 sm:divide-x">
            <ScrollArea className="w-64 sm:w-auto">
              <div className="flex sm:flex-col p-2">
                {hours.map((hour) => (
                  <Button
                    key={hour}
                    size="icon"
                    variant={
                      date && date.getHours() % 12 === hour % 12
                        ? "default"
                        : "ghost"
                    }
                    className="sm:w-full shrink-0 aspect-square"
                    onClick={() => handleTimeChange("hour", hour.toString())}
                  >
                    {hour}
                  </Button>
                ))}
              </div>
              <ScrollBar orientation="horizontal" className="sm:hidden" />
            </ScrollArea>
            <ScrollArea className="w-64 sm:w-auto">
              <div className="flex sm:flex-col p-2">
                {minutes.map((minute) => (
                  <Button
                    key={minute}
                    size="icon"
                    variant={
                      date && date.getMinutes() === minute
                        ? "default"
                        : "ghost"
                    }
                    className="sm:w-full shrink-0 aspect-square"
                    onClick={() =>
                      handleTimeChange("minute", minute.toString())
                    }
                  >
                    {minute.toString().padStart(2, "0")}
                  </Button>
                ))}
              </div>
              <ScrollBar orientation="horizontal" className="sm:hidden" />
            </ScrollArea>
            <ScrollArea className="">
              <div className="flex sm:flex-col p-2">
                {["AM", "PM"].map((ampm) => (
                  <Button
                    key={ampm}
                    size="icon"
                    variant={
                      date &&
                      ((ampm === "AM" && date.getHours() < 12) ||
                        (ampm === "PM" && date.getHours() >= 12))
                        ? "default"
                        : "ghost"
                    }
                    className="sm:w-full shrink-0 aspect-square"
                    onClick={() => handleTimeChange("ampm", ampm)}
                  >
                    {ampm}
                  </Button>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>

        {/* Action buttons */}
        <div className="p-3 border-t flex justify-between">
          {clearable && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <X className="mr-2 h-4 w-4" />
              Clear
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDone}
            className="ml-auto"
          >
            <Check className="mr-2 h-4 w-4" />
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
