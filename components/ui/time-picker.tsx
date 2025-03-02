"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";
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
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Clock } from "lucide-react";

interface TimePickerProps {
  value: string;
  onChangeAction: (time: string) => void;
  label?: string;
  error?: boolean;
  errorMessage?: string;
}

export function TimePicker({
  value,
  onChangeAction,
  label,
  error,
  errorMessage,
}: TimePickerProps) {
  const parseTime = (timeString: string) => {
    if (!timeString) return { hour: 9, minute: 0, period: "AM" as const };
    try {
      const [h, m] = timeString.split(":");
      const hour = parseInt(h);
      const minute = parseInt(m);
      if (isNaN(hour) || isNaN(minute))
        return { hour: 9, minute: 0, period: "AM" as const };

      const period = hour >= 12 ? ("PM" as const) : ("AM" as const);
      const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      return { hour: hour12, minute, period };
    } catch {
      return { hour: 9, minute: 0, period: "AM" as const };
    }
  };

  const formatTime = (timeString: string) => {
    const { hour, minute, period } = parseTime(timeString);
    return `${hour}:${minute.toString().padStart(2, "0")} ${period}`;
  };

  const { hour, minute, period } = parseTime(value);
  const [selectedHour, setSelectedHour] = React.useState(hour);
  const [selectedMinute, setSelectedMinute] = React.useState(minute);
  const [selectedPeriod, setSelectedPeriod] = React.useState(period);

  const handleTimeChange = (
    newHour: number,
    newMinute: number,
    newPeriod: "AM" | "PM",
  ) => {
    let hour24 = newHour;
    if (newPeriod === "PM" && newHour !== 12) {
      hour24 += 12;
    } else if (newPeriod === "AM" && newHour === 12) {
      hour24 = 0;
    }

    const timeString = `${hour24.toString().padStart(2, "0")}:${newMinute.toString().padStart(2, "0")}`;
    onChangeAction(timeString);
  };

  React.useEffect(() => {
    const { hour, minute, period } = parseTime(value);
    setSelectedHour(hour);
    setSelectedMinute(minute);
    setSelectedPeriod(period);
  }, [value]);

  return (
    <div className="flex flex-col gap-2">
      {label && (
        <div className="flex justify-between items-baseline">
          <Label>{label}</Label>
          {error && errorMessage && (
            <span className="text-xs text-destructive animate-in fade-in">
              {errorMessage}
            </span>
          )}
        </div>
      )}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal",
              !value && "text-muted-foreground",
              error && "border-destructive text-destructive",
              error && "hover:border-destructive",
            )}
          >
            <Clock
              className={cn("mr-2 h-4 w-4", error && "text-destructive")}
            />
            {value ? formatTime(value) : "Select time"}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={4}
          className="w-[280px] p-4 sm:w-auto"
        >
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-2">
              <Select
                value={selectedHour.toString()}
                onValueChange={(value) => {
                  const newHour = parseInt(value);
                  setSelectedHour(newHour);
                  handleTimeChange(newHour, selectedMinute, selectedPeriod);
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Hour" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className="h-[180px] min-w-[80px]"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                    <SelectItem key={h} value={h.toString()}>
                      {h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={selectedMinute.toString()}
                onValueChange={(value) => {
                  const newMinute = parseInt(value);
                  setSelectedMinute(newMinute);
                  handleTimeChange(selectedHour, newMinute, selectedPeriod);
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Min" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className="h-[180px] min-w-[80px]"
                >
                  {Array.from({ length: 60 }, (_, i) => i).map((m) => (
                    <SelectItem key={m} value={m.toString()}>
                      {m.toString().padStart(2, "0")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={selectedPeriod}
                onValueChange={(value: "AM" | "PM") => {
                  setSelectedPeriod(value);
                  handleTimeChange(selectedHour, selectedMinute, value);
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="AM/PM" />
                </SelectTrigger>
                <SelectContent position="popper" className="min-w-[80px]">
                  <SelectItem value="AM">AM</SelectItem>
                  <SelectItem value="PM">PM</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Hour</span>
              <span>Minute</span>
              <span>Period</span>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
