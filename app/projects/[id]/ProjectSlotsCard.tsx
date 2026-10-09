"use client";

import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Pause } from "lucide-react";

import type { Project, ProjectStatus } from "@/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  getMultiDaySlotDisplayName,
  isMultiDaySlotPastByScheduleId,
  isOneTimeSlotPast,
  isSameDayMultiAreaSlotPast,
} from "@/utils/project";
import {
  ProjectSlotRow,
  formatScheduleDay,
  formatSlotTimeRange,
} from "./ProjectSlotRow";

const formatSlotCapacity = (value: unknown) => {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
};

/**
 * The schedule as a list of slots, grouped by day. Each row carries its own
 * action; notices about paused, cancelled or completed projects sit with it.
 */
export function ProjectSlotsCard({
  project,
  calculatedStatus,
  remainingSlots,
  headerAction,
  renderAction,
  renderAttendees,
}: {
  project: Project;
  calculatedStatus: ProjectStatus;
  remainingSlots: Record<string, number>;
  headerAction?: ReactNode;
  renderAction: (scheduleId: string, isPast: boolean) => ReactNode;
  renderAttendees: (scheduleId: string) => ReactNode;
}) {
  const { schedule } = project;

  return (
    <Card id="volunteer-opportunities" className="scroll-mt-20">
      <CardHeader>
        <div className="flex w-full items-center justify-between gap-2">
          <CardTitle>Volunteer opportunities</CardTitle>
          {headerAction}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {project.pause_signups && (
          <Alert variant="warning">
            <Pause aria-hidden="true" />
            <AlertTitle>Signups are currently paused</AlertTitle>
            <AlertDescription>
              The project organizer has temporarily paused new volunteer
              signups. Please check back later or contact the organizer.
            </AlertDescription>
          </Alert>
        )}

        {project.event_type === "oneTime" && schedule.oneTime && (
          <div className="grid gap-2">
            <h3 className="text-sm font-medium">
              {formatScheduleDay(schedule.oneTime.date)}
            </h3>
            <ul className="divide-y">
              <ProjectSlotRow
                timeLabel={formatSlotTimeRange(
                  schedule.oneTime.startTime,
                  schedule.oneTime.endTime,
                )}
                timezone={project.project_timezone}
                date={schedule.oneTime.date}
                remaining={
                  remainingSlots["oneTime"] ??
                  formatSlotCapacity(schedule.oneTime.volunteers)
                }
                capacity={formatSlotCapacity(schedule.oneTime.volunteers)}
                action={renderAction("oneTime", isOneTimeSlotPast(project))}
                attendees={renderAttendees("oneTime")}
              />
            </ul>
          </div>
        )}

        {project.event_type === "multiDay" &&
          schedule.multiDay &&
          schedule.multiDay.map((day, dayIndex) => {
            const allSlotsInDayPast = day.slots.every((slot, slotIndex) =>
              isMultiDaySlotPastByScheduleId(
                project,
                `${day.date}-${dayIndex}-${slotIndex}`,
              ),
            );

            return (
              <div
                key={`${day.date}-${dayIndex}`}
                className="grid gap-2 border-t pt-4 first:border-t-0 first:pt-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">
                    {formatScheduleDay(day.date)}
                  </h3>
                  {allSlotsInDayPast && (
                    <Badge variant="secondary">Passed</Badge>
                  )}
                </div>
                <ul
                  className={cn("divide-y", allSlotsInDayPast && "opacity-50")}
                >
                  {day.slots.map((slot, slotIndex) => {
                    const scheduleId = `${day.date}-${dayIndex}-${slotIndex}`;
                    return (
                      <ProjectSlotRow
                        key={scheduleId}
                        title={getMultiDaySlotDisplayName(slot, slotIndex)}
                        timeLabel={formatSlotTimeRange(
                          slot.startTime,
                          slot.endTime,
                        )}
                        timezone={project.project_timezone}
                        date={day.date}
                        remaining={
                          remainingSlots[scheduleId] ??
                          formatSlotCapacity(slot.volunteers)
                        }
                        capacity={formatSlotCapacity(slot.volunteers)}
                        action={renderAction(
                          scheduleId,
                          isMultiDaySlotPastByScheduleId(project, scheduleId),
                        )}
                        attendees={renderAttendees(scheduleId)}
                      />
                    );
                  })}
                </ul>
              </div>
            );
          })}

        {project.event_type === "sameDayMultiArea" &&
          schedule.sameDayMultiArea && (
            <div className="grid gap-2">
              <h3 className="text-sm font-medium">
                {formatScheduleDay(schedule.sameDayMultiArea.date)}
              </h3>
              <ul className="divide-y">
                {schedule.sameDayMultiArea.roles.map((role) => (
                  <ProjectSlotRow
                    key={role.name}
                    title={role.name}
                    timeLabel={formatSlotTimeRange(
                      role.startTime,
                      role.endTime,
                    )}
                    timezone={project.project_timezone}
                    date={schedule.sameDayMultiArea?.date}
                    remaining={
                      remainingSlots[role.name] ??
                      formatSlotCapacity(role.volunteers)
                    }
                    capacity={formatSlotCapacity(role.volunteers)}
                    action={renderAction(
                      role.name,
                      isSameDayMultiAreaSlotPast(project, role.name),
                    )}
                    attendees={renderAttendees(role.name)}
                  />
                ))}
              </ul>
            </div>
          )}

        {calculatedStatus === "cancelled" && (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertDescription>
              <p>
                This project has been cancelled and is no longer accepting
                signups.
              </p>
              {project.cancellation_reason && (
                <p className="mt-1">
                  <span className="font-medium">Reason:</span>{" "}
                  {project.cancellation_reason}
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}

        {calculatedStatus === "completed" && (
          <Alert>
            <CheckCircle2 aria-hidden="true" />
            <AlertDescription>
              This project has been completed and is no longer accepting
              signups.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
