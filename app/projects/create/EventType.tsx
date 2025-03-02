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
  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose Event Type</CardTitle>
        <p className="text-sm text-muted-foreground">
          Select the format that best fits your event
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div
          className={cn(
            "p-6 rounded-lg border-2 cursor-pointer transition-all",
            eventType === "oneTime"
              ? "border-primary bg-primary/5"
              : "hover:bg-muted/50",
          )}
          onClick={() => setEventTypeAction("oneTime")}
        >
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <h3 className="font-medium mb-1">Single Event</h3>
              <p className="text-sm text-muted-foreground">
                A one-time event on a specific date
              </p>
            </div>
            <div className="w-12 h-12 flex items-center justify-center rounded-lg bg-primary/10">
              <CalendarIcon className="h-6 w-6 text-primary" />
            </div>
          </div>
          {eventType === "oneTime" && (
            <div className="mt-4 p-4 bg-card rounded-md">
              <p className="text-sm">
                Example: Beach cleanup event on February 20th, 2024 from 4 PM to
                9 PM
              </p>
            </div>
          )}
        </div>

        <div
          className={cn(
            "p-6 rounded-lg border-2 cursor-pointer transition-all",
            eventType === "multiDay"
              ? "border-primary bg-primary/5"
              : "hover:bg-muted/50",
          )}
          onClick={() => setEventTypeAction("multiDay")}
        >
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <h3 className="font-medium mb-1">Multiple Day Event</h3>
              <p className="text-sm text-muted-foreground">
                Event spans across multiple days with different time slots
              </p>
            </div>
            <div className="w-12 h-12 flex items-center justify-center rounded-lg bg-primary/10">
              <CalendarClock className="h-6 w-6 text-primary" />
            </div>
          </div>
          {eventType === "multiDay" && (
            <div className="mt-4 p-4 bg-card rounded-md">
              <p className="text-sm">
                Example: Workshop series with morning and afternoon sessions
                across different days
              </p>
            </div>
          )}
        </div>

        <div
          className={cn(
            "p-6 rounded-lg border-2 cursor-pointer transition-all",
            eventType === "sameDayMultiArea"
              ? "border-primary bg-primary/5"
              : "hover:bg-muted/50",
          )}
          onClick={() => setEventTypeAction("sameDayMultiArea")}
        >
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <h3 className="font-medium mb-1">Multi-Role Event</h3>
              <p className="text-sm text-muted-foreground">
                Single day event with different volunteer roles
              </p>
            </div>
            <div className="w-12 h-12 flex items-center justify-center rounded-lg bg-primary/10">
              <UsersRound className="h-6 w-6 text-primary" />
            </div>
          </div>
          {eventType === "sameDayMultiArea" && (
            <div className="mt-4 p-4 bg-card rounded-md">
              <p className="text-sm">
                Example: Community festival needing decorators, cooks, and
                cleaners at different times
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
