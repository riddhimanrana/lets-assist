"use client";

import { CalendarClock } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

import type { PaperScanSlotOption } from "./PaperSignupsClient";

interface ScheduleSlotStepProps {
  slotOptions: PaperScanSlotOption[];
  timezone: string;
  selectedSlotId: string | null;
  onSelect: (slotId: string) => void;
  onContinue: () => void;
}

function formatWindow(option: PaperScanSlotOption, timezone: string): string {
  const start = new Date(option.windowStartsAt);
  const end = new Date(option.windowEndsAt);
  const date = start.toLocaleDateString("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = (value: Date) =>
    value.toLocaleTimeString("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    });
  return `${date} · ${time(start)} – ${time(end)}`;
}

/**
 * One paper sheet belongs to one slot. The date/time range on each option is
 * how the organizer recognizes which physical sheet they are holding.
 */
export function ScheduleSlotStep({
  slotOptions,
  timezone,
  selectedSlotId,
  onSelect,
  onContinue,
}: ScheduleSlotStepProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Which session is this sheet for?</CardTitle>
        <CardDescription>
          Each scan records attendance for a single session. Scan multiple
          sheets one at a time.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {slotOptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This project&apos;s schedule could not be resolved, so paper sheets
            can&apos;t be attributed to a session.
          </p>
        ) : (
          <div role="radiogroup" className="flex flex-col gap-2">
            {slotOptions.map((option) => {
              const selected = option.id === selectedSlotId;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onSelect(option.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border p-4 text-left transition-colors",
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50",
                  )}
                >
                  <CalendarClock
                    className={cn(
                      "size-5 shrink-0",
                      selected ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  <span className="flex flex-col">
                    <span className="font-medium">{option.label}</span>
                    <span className="text-sm text-muted-foreground">
                      {formatWindow(option, timezone)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button
          disabled={!selectedSlotId}
          onClick={onContinue}
          className="w-full sm:w-auto"
        >
          Continue to photos
        </Button>
      </CardFooter>
    </Card>
  );
}
