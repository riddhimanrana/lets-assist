"use client";
import { safeConsole } from "@/lib/safe-console";

import React from "react";
import { parseISO, differenceInSeconds } from "date-fns";
import { Project } from "@/types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  getMultiDaySlotByScheduleId,
  getMultiDaySlotDisplayName,
} from "@/utils/project";
import Link from "next/link";

interface VolunteerStatusCardProps {
  project: Project;
  signup: { check_in_time: string | null; schedule_id: string };
}

export default function VolunteerStatusCard({
  project,
  signup,
}: VolunteerStatusCardProps) {
  // Determine session timing from project data
  const scheduleId = signup.schedule_id;
  let sessionDate = "";
  let endTime = "";
  let sessionLabel = scheduleId;

  if (project.event_type === "oneTime" && project.schedule.oneTime) {
    sessionDate = project.schedule.oneTime.date;
    endTime = project.schedule.oneTime.endTime;
    sessionLabel = "Main event";
  } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
    const slotData = getMultiDaySlotByScheduleId(project, scheduleId);
    if (slotData) {
      const { day, slot, slotIndex } = slotData;
      sessionDate = day.date;
      endTime = slot.endTime;
      sessionLabel = getMultiDaySlotDisplayName(slot, slotIndex);
    }
  } else if (
    project.event_type === "sameDayMultiArea" &&
    project.schedule.sameDayMultiArea
  ) {
    const role = project.schedule.sameDayMultiArea.roles.find(
      (r) => r.name === scheduleId,
    );
    if (role) {
      sessionDate = project.schedule.sameDayMultiArea.date;
      endTime = role.endTime;
      sessionLabel = role.name;
    }
  }

  // Calculate progress
  let percent = 0;
  // Add null check here
  if (signup.check_in_time && sessionDate && endTime) {
    try {
      const checkIn = parseISO(signup.check_in_time); // Now safe
      const endDt = parseISO(`${sessionDate}T${endTime}`);
      // Ensure endDt is valid before proceeding
      if (!isNaN(endDt.getTime())) {
        const totalSec = Math.max(1, differenceInSeconds(endDt, checkIn));
        const elapsedSec = Math.min(
          totalSec,
          differenceInSeconds(new Date(), checkIn),
        );
        percent = Math.round((elapsedSec / totalSec) * 100);
      } else {
        safeConsole.error(
          "Invalid session end time:",
          `${sessionDate}T${endTime}`,
        );
      }
    } catch (error) {
      safeConsole.error("Error parsing dates for progress:", error);
    }
  }

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-md items-center px-4 py-12 sm:px-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Current check-in status</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p>
            You are checked in to <strong>{project.title}</strong> (
            {sessionLabel}).
          </p>
          {/* Ensure Progress component receives a valid number */}
          <div className="grid gap-1.5">
            <Progress value={percent} aria-label="Session progress" />
            <p className="text-muted-foreground text-sm tabular-nums">
              {percent}% of session completed
            </p>
          </div>
          <Link
            href="/profile"
            className={buttonVariants({ variant: "outline" })}
          >
            View my contributions
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
