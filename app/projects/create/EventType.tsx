// EventType Component - Handles the event type selection step

"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarIcon, CalendarClock, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";

interface EventTypeProps {
  eventType: "oneTime" | "multiDay" | "sameDayMultiArea";
  setEventTypeAction: (
    type: "oneTime" | "multiDay" | "sameDayMultiArea",
  ) => void;
}

export default function EventType({
  eventType,
  setEventTypeAction,
}: EventTypeProps) {
  const renderEventCard = (
    type: "oneTime" | "multiDay" | "sameDayMultiArea",
    title: string,
    description: string,
    icon: React.ReactNode,
    example: string
  ) => (
    <div
      className={cn(
        "p-3 sm:p-4 rounded-lg border-2 cursor-pointer transition-all",
        eventType === type
          ? "border-primary bg-primary/5"
          : "hover:bg-muted/50",
      )}
      onClick={() => setEventTypeAction(type)}
    >
      <div className="flex gap-3">
        <div className="w-10 h-10 sm:w-12 sm:h-12 flex-shrink-0 flex items-center justify-center rounded-md sm:rounded-lg bg-primary/10">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-sm sm:text-base mb-0.5">{title}</h3>
          <p className="text-xs sm:text-sm text-muted-foreground leading-snug">
            {description}
          </p>
        </div>
      </div>
      {eventType === type && (
        <div className="mt-3 sm:mt-4 pl-13 sm:pl-16">
          <p className="text-xs sm:text-sm text-muted-foreground bg-card/50 rounded p-2 sm:p-3 leading-snug">
            {example}
          </p>
        </div>
      )}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl sm:text-2xl">Choose Event Type</CardTitle>
        <p className="text-xs sm:text-sm text-muted-foreground">
          Select the format that best fits your event
        </p>
      </CardHeader>
      <CardContent className="space-y-3 sm:space-y-4">
        {renderEventCard(
          "oneTime",
          "Single Event",
          "A one-time event on a specific date",
          <CalendarIcon className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />,
          "Beach cleanup event on Feb 20th, 2024 from 4 PM to 9 PM"
        )}

        {renderEventCard(
          "multiDay",
          "Multiple Day Event",
          "Event spans across multiple days with different time slots",
          <CalendarClock className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />,
          "Workshop series with morning and afternoon sessions across different days"
        )}

        {renderEventCard(
          "sameDayMultiArea",
          "Multi-Role Event",
          "Single day event with different volunteer roles",
          <UsersRound className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />,
          "Community festival needing decorators, cooks, and cleaners at different times"
        )}
      </CardContent>
    </Card>
  );
}
