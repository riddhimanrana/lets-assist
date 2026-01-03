/**
 * Get Synced Events
 * GET /api/calendar/synced-events
 */

import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import type { SyncedEvent, MultiDayScheduleDay, SameDayMultiAreaRole } from "@/types";

export async function GET(_request: Request) {
  try {
    const supabase = await createClient();

    // Check if user is authenticated
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const syncedEvents: SyncedEvent[] = [];

    // Get synced projects (where user is creator)
    const { data: projects, error: projectsError } = await supabase
      .from("projects")
      .select("id, title, schedule, event_type, creator_calendar_event_id, creator_synced_at")
      .eq("creator_id", user.id)
      .not("creator_calendar_event_id", "is", null);

    if (!projectsError && projects) {
      for (const project of projects) {
        // Parse schedule to get time information
        let startTime = "";
        let endTime = "";
        let scheduleId = "";

        if (project.event_type === "oneTime" && project.schedule.oneTime) {
          const s = project.schedule.oneTime;
          startTime = `${s.date}T${s.startTime}`;
          endTime = `${s.date}T${s.endTime}`;
          scheduleId = "oneTime";
        } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
          const firstDay = project.schedule.multiDay[0];
          const firstSlot = firstDay.slots[0];
          startTime = `${firstDay.date}T${firstSlot.startTime}`;
          endTime = `${firstDay.date}T${firstSlot.endTime}`;
          scheduleId = `${firstDay.date}-0`;
        } else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
          const s = project.schedule.sameDayMultiArea;
          const firstRole = s.roles[0];
          startTime = `${s.date}T${firstRole.startTime}`;
          endTime = `${s.date}T${firstRole.endTime}`;
          scheduleId = firstRole.name;
        }

        syncedEvents.push({
          id: project.id,
          project_id: project.id,
          project_title: project.title,
          schedule_id: scheduleId,
          event_type: "creator",
          start_time: startTime,
          end_time: endTime,
          synced_at: project.creator_synced_at!,
          calendar_event_id: project.creator_calendar_event_id!,
        });
      }
    }

    // Get synced signups (where user is volunteer)
    const { data: signups, error: signupsError } = await supabase
      .from("project_signups")
      .select(`
        id,
        schedule_id,
        volunteer_calendar_event_id,
        volunteer_synced_at,
        projects:project_id (
          id,
          title,
          schedule,
          event_type
        )
      `)
      .eq("user_id", user.id)
      .not("volunteer_calendar_event_id", "is", null);

    if (!signupsError && signups) {
      for (const signup of signups) {
        if (!signup.projects) continue;

        const project = Array.isArray(signup.projects) 
          ? signup.projects[0] 
          : signup.projects;

        // Parse schedule based on schedule_id
        let startTime = "";
        let endTime = "";

        if (project.event_type === "oneTime" && project.schedule.oneTime) {
          const s = project.schedule.oneTime;
          startTime = `${s.date}T${s.startTime}`;
          endTime = `${s.date}T${s.endTime}`;
        } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
          const [date, slotIndex] = signup.schedule_id.split("-");
          const day = project.schedule.multiDay.find((d: MultiDayScheduleDay) => d.date === date);
          if (day) {
            const slot = day.slots[parseInt(slotIndex)];
            startTime = `${date}T${slot.startTime}`;
            endTime = `${date}T${slot.endTime}`;
          }
        } else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
          const s = project.schedule.sameDayMultiArea;
          const role = s.roles.find((r: SameDayMultiAreaRole) => r.name === signup.schedule_id);
          if (role) {
            startTime = `${s.date}T${role.startTime}`;
            endTime = `${s.date}T${role.endTime}`;
          }
        }

        syncedEvents.push({
          id: signup.id,
          project_id: project.id,
          project_title: project.title,
          schedule_id: signup.schedule_id,
          event_type: "volunteer",
          start_time: startTime,
          end_time: endTime,
          synced_at: signup.volunteer_synced_at!,
          calendar_event_id: signup.volunteer_calendar_event_id!,
        });
      }
    }

    // Sort by synced_at descending
    syncedEvents.sort((a, b) => 
      new Date(b.synced_at).getTime() - new Date(a.synced_at).getTime()
    );

    return NextResponse.json({
      events: syncedEvents,
      total: syncedEvents.length,
    });
  } catch (error) {
    console.error("Error getting synced events:", error);
    return NextResponse.json(
      { error: "Failed to get synced events" },
      { status: 500 }
    );
  }
}
