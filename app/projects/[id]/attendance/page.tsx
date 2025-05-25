import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";
import { AttendanceClient } from "./AttendanceClient";
import { addHours, isBefore } from "date-fns";

async function checkAttendanceAvailability(projectId: string) {
  const cookieStore = cookies();
  const supabase = await createClient();
  
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (!project) return { isActive: false };

  const now = new Date();
  let earliestTime: Date | null = null;
  let isActive = false;

  if (project.event_type === "oneTime" && project.schedule.oneTime) {
    const { date, startTime } = project.schedule.oneTime;
    const [year, month, day] = date.split('-').map(Number);
    const [hours, minutes] = startTime.split(':').map(Number);
    
    const sessionStart = new Date(year, month - 1, day, hours, minutes);
    const attendanceOpenTime = addHours(sessionStart, -2);
    
    if (!isBefore(now, attendanceOpenTime)) {
      isActive = true;
    }
    earliestTime = sessionStart;
  } 
  else if (project.event_type === "multiDay" && project.schedule.multiDay) {
    type MultiDaySlot = { startTime: string };
    type MultiDayDay = { date: string; slots: MultiDaySlot[] };

    (project.schedule.multiDay as MultiDayDay[]).forEach((day: MultiDayDay) => {
      const [year, month, dayNum] = day.date.split('-').map(Number);
      
      day.slots.forEach((slot: MultiDaySlot) => {
        const [hours, minutes] = slot.startTime.split(':').map(Number);
        const sessionStart = new Date(year, month - 1, dayNum, hours, minutes);
        const attendanceOpenTime = addHours(sessionStart, -2);
        
        if (!isBefore(now, attendanceOpenTime)) {
          isActive = true;
        }
        
        if (!earliestTime || isBefore(sessionStart, earliestTime)) {
          earliestTime = sessionStart;
        }
      });
    });
  }
  else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
    const { date, roles } = project.schedule.sameDayMultiArea;
    const [year, month, day] = date.split('-').map(Number);
    
    type Role = { startTime: string };
    roles.forEach((role: Role) => {
      const [hours, minutes] = role.startTime.split(':').map(Number);
      const sessionStart = new Date(year, month - 1, day, hours, minutes);
      const attendanceOpenTime = addHours(sessionStart, -2);
      
      if (!isBefore(now, attendanceOpenTime)) {
        isActive = true;
      }
      
      if (!earliestTime || isBefore(sessionStart, earliestTime)) {
        earliestTime = sessionStart;
      }
    });
  }

  return {
    isActive,
    earliestTime: earliestTime?.toISOString(),
    project
  };
}

export default async function AttendancePage({ params }: { params: Promise<{ id: string }> }) {
    const { id: projectId } = await params;
    const availability = await checkAttendanceAvailability(projectId)
  
  return <AttendanceClient 
    projectId={projectId} 
    initialAvailability={availability}
  />;
}
