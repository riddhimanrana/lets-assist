"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AlertCircle } from "lucide-react";

interface TimePickerProps {
  value: string;
  onChangeAction: (time: string) => void;
  label?: string;
  error?: boolean;
  errorMessage?: string;
  disabled?: boolean;
}

export function TimePicker({
  value,
  onChangeAction,
  label,
  error,
  errorMessage,
  disabled = false,
}: TimePickerProps) {
  return (
    <div className="space-y-2">
      {label && <Label>{label}</Label>}
      <div className="relative">
        <Input
          type="time"
          value={value}
          onChange={(e) => onChangeAction(e.target.value)}
          disabled={disabled}
          className={cn(
            "w-full bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none",
            !value && "text-muted-foreground",
            error && "border-destructive focus-visible:ring-destructive/20",
          )}
        />
      </div>
      {error && errorMessage && (
        <div className="text-destructive text-sm flex items-center gap-1.5 mt-1">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
}
