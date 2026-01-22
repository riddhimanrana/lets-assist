"use client";

import React from "react";
import { parseISO, differenceInSeconds } from "date-fns";
import { Project } from "@/types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import Link from "next/link";

interface VolunteerStatusCardProps {
  project: Project;
  signup: { check_in_time: string | null; schedule_id: string };
}

export default function VolunteerStatusCard({ project, signup }: VolunteerStatusCardProps) {
  // Determine session timing from project data
  const scheduleId = signup.schedule_id;
  let sessionDate = "";
  let endTime = "";
  
  if (project.event_type === "oneTime" && project.schedule.oneTime) {
    sessionDate = project.schedule.oneTime.date;
    endTime = project.schedule.oneTime.endTime;
  } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
    const [date, idx] = scheduleId.split("-");
    const day = project.schedule.multiDay.find(d => d.date === date);
    const slot = day?.slots[parseInt(idx, 10)];
    if (day && slot) {
      sessionDate = day.date;
      endTime = slot.endTime;
    }
  } else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
    const role = project.schedule.sameDayMultiArea.roles.find(r => r.name === scheduleId);
    if (role) {
      sessionDate = project.schedule.sameDayMultiArea.date;
      endTime = role.endTime;
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
        const elapsedSec = Math.min(totalSec, differenceInSeconds(new Date(), checkIn));
        percent = Math.round((elapsedSec / totalSec) * 100);
      } else {
        console.error("Invalid session end time:", `${sessionDate}T${endTime}`);
      }
    } catch (error) {
      console.error("Error parsing dates for progress:", error);
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Current Check-in Status</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-2">You are checked in to <strong>{project.title}</strong> ({scheduleId}).</p>
        {/* Ensure Progress component receives a valid number */}
        <Progress value={percent} className="h-4 mb-2" aria-label="Session progress" />
        <p className="text-sm text-muted-foreground">{percent}% of session completed</p>
        <div className="mt-4">
          <Link href="/profile" className="text-sm text-blue-600 hover:underline">
            View My Contributions
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
