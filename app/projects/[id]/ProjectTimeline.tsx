"use client";

import { useState, useEffect, useMemo } from "react"; // Removed useRef
import { Project } from "@/types";
import {
  format,
  addHours,
  subHours,
  isAfter,
  isBefore,
  isSameDay,
} from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogFooter,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Clock,
  Calendar,
  UsersRound,
  UserCheck,
  ClipboardList,
  AlertTriangle,
  GanttChart,
  CheckCheck,
  CalendarCheck,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getProjectStartDateTime,
  getProjectEndDateTime,
} from "@/utils/project";
import { Badge } from "@/components/ui/badge";
// Removed motion, AnimatePresence imports
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
// Import the new Timeline components
import {
  Timeline,
  TimelineItem,
  TimelineConnector,
  TimelineHeader,
  TimelineIcon,
  TimelineTitle,
  TimelineContent,
} from "@/components/ui/timeline"; // Adjust path if needed
import { getMultiDaySlotDisplayName } from "@/utils/project";

interface ProjectTimelineProps {
  project: Project;
  open: boolean;
  onOpenAction: (open: boolean) => void;
}

// Interface for main timeline milestones
interface TimelineMilestone {
  id: string;
  title: string;
  date: Date; // Represents the primary date for sorting/positioning
  startDate?: Date; // Explicit start for ranges
  endDate?: Date; // Explicit end for ranges
  description: string;
  icon: React.ReactNode;
  isPassed: boolean;
  isCurrent: boolean; // Add isCurrent property
  children?: TimelineEvent[];
  category: string;
}

// Interface for timeline events (children of milestones)
interface TimelineEvent {
  id: string;
  title: string;
  date: Date; // Represents the primary date for sorting/positioning
  startDate?: Date; // Explicit start for ranges
  endDate?: Date; // Explicit end for ranges
  description: string;
  icon: React.ReactNode;
  isPassed: boolean;
  isCurrent: boolean; // Add isCurrent property
  details?: React.ReactNode;
  category: string;
}

// Removed the calculateProgress function (lines 60-148)

export default function ProjectTimeline({
  project,
  open,
  onOpenAction,
}: ProjectTimelineProps) {
  // State variables
  const createdDate = new Date(project.created_at);
  const now = new Date();
  const [currentTimestamp, setCurrentTimestamp] = useState<number>(
    now.getTime(),
  );
  const [activeTab, setActiveTab] = useState<string>("all");
  // Removed currentProgress state
  const [milestones, setMilestones] = useState<TimelineMilestone[]>([]);

  // Removed refs (containerRef, milestoneRefs) and isCalculatingPositions state

  // Removed useEffect for resetting milestoneRefs

  // Update current time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTimestamp(Date.now());
    }, 60000);

    return () => clearInterval(interval);
  }, []); // Empty dependency array since this effect only needs to run once

  // Removed useEffect for calculateProgressFromDOM (lines 170-178)

  // Removed the calculateProgressFromDOM function (lines 180-328)

  // Get tabs based on project type
  const tabs = useMemo(() => {
    const result = [{ id: "all", label: "All Events" }];

    if (project.event_type === "multiDay" && project.schedule.multiDay) {
      project.schedule.multiDay.forEach((day, index) => {
        result.push({
          id: `day-${index}`,
          label: format(new Date(day.date), "MMM d"),
        });
      });
    } else if (
      project.event_type === "sameDayMultiArea" &&
      project.schedule.sameDayMultiArea
    ) {
      project.schedule.sameDayMultiArea.roles.forEach((role, index) => {
        result.push({
          id: `role-${index}`,
          label: role.name,
        });
      });
    }

    return result;
  }, [project]);

  // Generate timeline milestones and events
  useEffect(() => {
    const now = new Date(currentTimestamp); // Use currentTimestamp instead of creating new Date
    const newMilestones: TimelineMilestone[] = [];

    // Project Creation milestone
    newMilestones.push({
      id: "creation",
      title: "Project Created",
      date: createdDate,
      startDate: createdDate,
      description:
        "Project setup with details, schedule, and volunteer requirements.",
      icon: <Star className="h-5 w-5" />,
      isPassed: isAfter(now, createdDate),
      isCurrent: false, // Creation is never 'current' in this context
      category: "all",
    });

    if (project.event_type === "oneTime" && project.schedule.oneTime) {
      // One-time event handling
      const startDateTime = getProjectStartDateTime(project);
      const endDateTime = getProjectEndDateTime(project);
      const checkInStartTime = subHours(startDateTime, 1);
      const attendanceEditDeadline = addHours(endDateTime, 48);

      // Signup Window milestone
      const isSignupCurrent =
        isAfter(now, createdDate) && isBefore(now, checkInStartTime);
      newMilestones.push({
        id: "signup-window",
        title: "Volunteer Sign-up Window",
        date: createdDate, // Position based on creation date
        startDate: createdDate,
        endDate: checkInStartTime,
        description: `Volunteers can sign up until ${format(checkInStartTime, "h:mm a")} on event day.`,
        icon: <UsersRound className="h-5 w-5" />,
        isPassed: isAfter(now, checkInStartTime),
        isCurrent: isSignupCurrent,
        category: "all",
      });

      // Event Day milestone with child events
      const isEventDayCurrent =
        isAfter(now, checkInStartTime) && isBefore(now, endDateTime);
      newMilestones.push({
        id: "event-day",
        title: "Event Day",
        date: startDateTime, // Position based on event start
        startDate: checkInStartTime, // Day starts with check-in
        endDate: endDateTime,
        description: format(startDateTime, "EEEE, MMMM d, yyyy"),
        icon: <Calendar className="h-5 w-5" />,
        isPassed: isAfter(now, endDateTime),
        isCurrent: isEventDayCurrent,
        category: "all",
        children: [
          {
            id: "checkin",
            title: "Check-in Begins",
            date: checkInStartTime,
            startDate: checkInStartTime,
            endDate: startDateTime,
            description: `${format(checkInStartTime, "h:mm a")}`,
            icon: <UserCheck className="size-4" />,
            isPassed: isAfter(now, startDateTime),
            isCurrent:
              isAfter(now, checkInStartTime) && isBefore(now, startDateTime),
            category: "all",
          },
          {
            id: "event",
            title: "Event",
            date: startDateTime,
            startDate: startDateTime,
            endDate: endDateTime,
            description: `${format(startDateTime, "h:mm a")} - ${format(endDateTime, "h:mm a")}`,
            icon: <Clock className="size-4" />,
            isPassed: isAfter(now, endDateTime),
            isCurrent:
              isAfter(now, startDateTime) && isBefore(now, endDateTime),
            details: (
              <div className="mt-2 bg-muted/40 rounded-md p-3">
                <div className="flex items-center">
                  <UsersRound className="size-4 mr-2 text-muted-foreground" />
                  <span className="text-sm">
                    {project.schedule.oneTime.volunteers} volunteer spots
                  </span>
                </div>
              </div>
            ),
            category: "all",
          },
        ],
      });

      // Post-Event milestone (Attendance Reporting)
      const isAttendanceCurrent =
        isAfter(now, endDateTime) && isBefore(now, attendanceEditDeadline);
      newMilestones.push({
        id: "post-event",
        title: "Attendance Reporting",
        date: endDateTime, // Position starts right after event ends
        startDate: endDateTime,
        endDate: attendanceEditDeadline,
        description: "Update volunteer attendance records.",
        icon: <ClipboardList className="h-5 w-5" />,
        isPassed: isAfter(now, attendanceEditDeadline),
        isCurrent: isAttendanceCurrent,
        category: "all",
        children: [
          {
            id: "attendance-deadline",
            title: "Deadline",
            date: attendanceEditDeadline, // Position at the deadline time
            startDate: attendanceEditDeadline,
            description: `Must be submitted by ${format(attendanceEditDeadline, "MMMM d, yyyy, h:mm a")}`,
            icon: <CalendarCheck className="size-4" />,
            isPassed: isAfter(now, attendanceEditDeadline),
            // Deadline itself isn't 'current', the period before it is
            isCurrent: false,
            category: "all",
          },
        ],
      });

      // Project Completion milestone
      newMilestones.push({
        id: "completion",
        title: "Project Completion",
        date: attendanceEditDeadline, // Positioned after the last deadline
        startDate: attendanceEditDeadline,
        description: "All records finalized.",
        icon: <CheckCheck className="h-5 w-5" />,
        isPassed: isAfter(now, attendanceEditDeadline),
        // Completion is 'current' once the deadline passes
        isCurrent: isAfter(now, attendanceEditDeadline),
        category: "all",
      });
    } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
      // Multi-day event handling

      let earliestCheckInOverall = new Date(8640000000000000);
      let latestDeadlineOverall = new Date(0);

      // Determine earliest check-in for signup window calculation
      project.schedule.multiDay.forEach((day) => {
        day.slots.forEach((slot) => {
          const dayDate = new Date(day.date);
          const slotStart = new Date(dayDate);
          slotStart.setHours(
            parseInt(slot.startTime.split(":")[0]),
            parseInt(slot.startTime.split(":")[1]),
          );
          const checkInTime = subHours(slotStart, 1);
          if (checkInTime < earliestCheckInOverall) {
            earliestCheckInOverall = checkInTime;
          }
        });
      });

      // Signup Window milestone
      const isSignupCurrent =
        isAfter(now, createdDate) && isBefore(now, earliestCheckInOverall);
      newMilestones.push({
        id: "signup-window-multi",
        title: "Volunteer Sign-up Window",
        date: createdDate,
        startDate: createdDate,
        endDate: earliestCheckInOverall,
        description:
          "Volunteers can sign up until one hour before each session's start time.",
        icon: <UsersRound className="h-5 w-5" />,
        isPassed: isAfter(now, earliestCheckInOverall),
        isCurrent: isSignupCurrent,
        category: "all",
      });

      // Process each day
      project.schedule.multiDay.forEach((day, dayIndex) => {
        const dayDate = new Date(day.date);
        const category = `day-${dayIndex}`;
        let dayStartTime = new Date(8640000000000000);
        let dayEndTime = new Date(0);

        const dayChildEvents: TimelineEvent[] = [];

        // Process slots within the day
        day.slots.forEach((slot, slotIndex) => {
          const slotLabel = getMultiDaySlotDisplayName(slot, slotIndex);
          const slotStart = new Date(dayDate);
          slotStart.setHours(
            parseInt(slot.startTime.split(":")[0]),
            parseInt(slot.startTime.split(":")[1]),
          );
          const slotEnd = new Date(dayDate);
          slotEnd.setHours(
            parseInt(slot.endTime.split(":")[0]),
            parseInt(slot.endTime.split(":")[1]),
          );
          const checkInTime = subHours(slotStart, 1);
          const editDeadline = addHours(slotEnd, 48);

          if (checkInTime < dayStartTime) dayStartTime = checkInTime;
          if (slotEnd > dayEndTime) dayEndTime = slotEnd;
          if (editDeadline > latestDeadlineOverall)
            latestDeadlineOverall = editDeadline;

          // Add check-in event for the day
          dayChildEvents.push({
            id: `day-${dayIndex}-slot-${slotIndex}-checkin`,
            title: `Check-in (${slotLabel})`,
            date: checkInTime,
            startDate: checkInTime,
            endDate: slotStart,
            description: format(checkInTime, "h:mm a"),
            icon: <UserCheck className="size-4" />,
            isPassed: isAfter(now, slotStart),
            isCurrent: isAfter(now, checkInTime) && isBefore(now, slotStart),
            category: category, // Belongs to specific day tab
          });

          // Add main event for the day
          dayChildEvents.push({
            id: `day-${dayIndex}-slot-${slotIndex}-event`,
            title: slotLabel,
            date: slotStart,
            startDate: slotStart,
            endDate: slotEnd,
            description: `${format(slotStart, "h:mm a")} - ${format(slotEnd, "h:mm a")}`,
            icon: <Clock className="size-4" />,
            isPassed: isAfter(now, slotEnd),
            isCurrent: isAfter(now, slotStart) && isBefore(now, slotEnd),
            details: (
              <div className="mt-2 bg-muted/40 rounded-md p-3">
                <div className="flex items-center">
                  <UsersRound className="size-4 mr-2 text-muted-foreground" />
                  <span className="text-sm">
                    {slot.volunteers} volunteer spots
                  </span>
                </div>
              </div>
            ),
            category: category, // Belongs to specific day tab
          });

          // Create Attendance Milestone for "All Events" tab
          const isAttendanceCurrent =
            isAfter(now, slotEnd) && isBefore(now, editDeadline);
          newMilestones.push({
            id: `attendance-all-${dayIndex}-${slotIndex}`,
            title: `Attendance: Day ${dayIndex + 1}, ${slotLabel}`,
            date: slotEnd, // Position starts after the slot ends
            startDate: slotEnd,
            endDate: editDeadline,
            description: `Update attendance for ${format(dayDate, "MMM d")} session.`,
            icon: <ClipboardList className="h-5 w-5" />,
            isPassed: isAfter(now, editDeadline),
            isCurrent: isAttendanceCurrent,
            category: "all", // Only for "All Events" tab
            children: [
              {
                id: `attendance-deadline-all-${dayIndex}-${slotIndex}`,
                title: "Deadline",
                date: editDeadline,
                startDate: editDeadline,
                description: format(editDeadline, "MMMM d, yyyy, h:mm a"),
                icon: <CalendarCheck className="size-4" />,
                isPassed: isAfter(now, editDeadline),
                isCurrent: false,
                category: "all",
              },
            ],
          });
        });

        // Sort child events for the day
        dayChildEvents.sort((a, b) => a.date.getTime() - b.date.getTime());

        // Create the main Day Milestone (for both "all" and specific day tabs)
        const isDayCurrent =
          isAfter(now, dayStartTime) && isBefore(now, dayEndTime);
        const dayMilestoneBase: Omit<TimelineMilestone, "category"> = {
          id: `day-${dayIndex}`,
          title: `Day ${dayIndex + 1}`,
          date: dayStartTime, // Position based on the earliest event of the day
          startDate: dayStartTime,
          endDate: dayEndTime,
          description: format(dayDate, "EEEE, MMMM d, yyyy"),
          icon: <Calendar className="h-5 w-5" />,
          isPassed: isAfter(now, dayEndTime),
          isCurrent: isDayCurrent,
          children: dayChildEvents.map((e) => ({ ...e, category: "all" })), // Children for 'all' tab
        };

        // Add for "all" tab
        newMilestones.push({ ...dayMilestoneBase, category: "all" });

        // Add for specific day tab (with specific category children and attendance)
        const daySpecificChildren = dayChildEvents.map((e) => ({
          ...e,
          category: category,
        }));

        // Add Attendance Milestone specifically for the Day Tab
        // Find the latest deadline for *this day*
        let latestDayDeadline = new Date(0);
        day.slots.forEach((slot) => {
          const slotEnd = new Date(dayDate);
          slotEnd.setHours(
            parseInt(slot.endTime.split(":")[0]),
            parseInt(slot.endTime.split(":")[1]),
          );
          const editDeadline = addHours(slotEnd, 48);
          if (editDeadline > latestDayDeadline)
            latestDayDeadline = editDeadline;
        });
        const isDayAttendanceCurrent =
          isAfter(now, dayEndTime) && isBefore(now, latestDayDeadline);

        const dayAttendanceMilestone: TimelineMilestone = {
          id: `attendance-day-${dayIndex}`,
          title: `Attendance Reporting`,
          date: dayEndTime, // Position after the last event of the day
          startDate: dayEndTime,
          endDate: latestDayDeadline,
          description: `Update attendance records for Day ${dayIndex + 1}.`,
          icon: <ClipboardList className="h-5 w-5" />,
          isPassed: isAfter(now, latestDayDeadline),
          isCurrent: isDayAttendanceCurrent,
          category: category, // Specific day category
          children: [
            {
              id: `attendance-deadline-day-${dayIndex}`,
              title: "Deadline",
              date: latestDayDeadline,
              startDate: latestDayDeadline,
              description: `Submit by ${format(latestDayDeadline, "MMMM d, yyyy, h:mm a")}`,
              icon: <CalendarCheck className="size-4" />,
              isPassed: isAfter(now, latestDayDeadline),
              isCurrent: false,
              category: category,
            },
          ],
        };

        newMilestones.push({
          ...dayMilestoneBase,
          category: category, // Specific day category
          children: daySpecificChildren, // Use children filtered for this category
        });
        // Add the day-specific attendance milestone *after* the day's events for that tab
        newMilestones.push(dayAttendanceMilestone);
      });

      // Add overall Project Completion milestone
      newMilestones.push({
        id: "completion-multi",
        title: "Project Completion",
        date: latestDeadlineOverall,
        startDate: latestDeadlineOverall,
        description: "All activities completed and records finalized.",
        icon: <CheckCheck className="h-5 w-5" />,
        isPassed: isAfter(now, latestDeadlineOverall),
        isCurrent: isAfter(now, latestDeadlineOverall),
        category: "all",
      });
    } else if (
      project.event_type === "sameDayMultiArea" &&
      project.schedule.sameDayMultiArea
    ) {
      // Multi-role, same day event handling
      const eventDate = new Date(project.schedule.sameDayMultiArea.date);
      let earliestCheckInOverall = new Date(8640000000000000);
      let latestEndOverall = new Date(0);
      let latestDeadlineOverall = new Date(0);

      // Determine earliest check-in and latest end/deadline
      project.schedule.sameDayMultiArea.roles.forEach((role) => {
        const roleStart = new Date(eventDate);
        roleStart.setHours(
          parseInt(role.startTime.split(":")[0]),
          parseInt(role.startTime.split(":")[1]),
        );
        const roleEnd = new Date(eventDate);
        roleEnd.setHours(
          parseInt(role.endTime.split(":")[0]),
          parseInt(role.endTime.split(":")[1]),
        );
        const checkInTime = subHours(roleStart, 1);
        const editDeadline = addHours(roleEnd, 48);

        if (checkInTime < earliestCheckInOverall)
          earliestCheckInOverall = checkInTime;
        if (roleEnd > latestEndOverall) latestEndOverall = roleEnd;
        if (editDeadline > latestDeadlineOverall)
          latestDeadlineOverall = editDeadline;
      });

      // Signup Window milestone
      const isSignupCurrent =
        isAfter(now, createdDate) && isBefore(now, earliestCheckInOverall);
      newMilestones.push({
        id: "signup-window-multi-area",
        title: "Volunteer Sign-up Window",
        date: createdDate,
        startDate: createdDate,
        endDate: earliestCheckInOverall,
        description:
          "Volunteers can sign up until one hour before each role's start time.",
        icon: <UsersRound className="h-5 w-5" />,
        isPassed: isAfter(now, earliestCheckInOverall),
        isCurrent: isSignupCurrent,
        category: "all",
      });

      // Event Day milestone (for "all" tab)
      const isEventDayCurrent =
        isAfter(now, earliestCheckInOverall) && isBefore(now, latestEndOverall);
      const eventDayChildren: TimelineEvent[] = [];

      // Process each role
      project.schedule.sameDayMultiArea.roles.forEach((role, roleIndex) => {
        const category = `role-${roleIndex}`;
        const roleStart = new Date(eventDate);
        roleStart.setHours(
          parseInt(role.startTime.split(":")[0]),
          parseInt(role.startTime.split(":")[1]),
        );
        const roleEnd = new Date(eventDate);
        roleEnd.setHours(
          parseInt(role.endTime.split(":")[0]),
          parseInt(role.endTime.split(":")[1]),
        );
        const roleCheckIn = subHours(roleStart, 1);
        const roleEditDeadline = addHours(roleEnd, 48);

        const isRoleCheckinCurrent =
          isAfter(now, roleCheckIn) && isBefore(now, roleStart);
        const isRoleActiveCurrent =
          isAfter(now, roleStart) && isBefore(now, roleEnd);
        const isRoleAttendanceCurrent =
          isAfter(now, roleEnd) && isBefore(now, roleEditDeadline);

        // Add Role details to Event Day children (for "all" tab)
        eventDayChildren.push({
          id: `all-role-${roleIndex}`,
          title: role.name,
          date: roleStart,
          startDate: roleStart,
          endDate: roleEnd,
          description: `${format(roleStart, "h:mm a")} - ${format(roleEnd, "h:mm a")}`,
          icon: <GanttChart className="size-4" />,
          isPassed: isAfter(now, roleEnd),
          isCurrent: isRoleActiveCurrent,
          details: (
            <div className="mt-2 bg-muted/40 rounded-md p-3">
              <div className="flex items-center">
                <UsersRound className="size-4 mr-2 text-muted-foreground" />
                <span className="text-sm">
                  {role.volunteers} volunteer spots
                </span>
              </div>
            </div>
          ),
          category: "all",
        });

        // Create Role-Specific Milestone (for role tab)
        const roleMilestone: TimelineMilestone = {
          id: `role-${roleIndex}`,
          title: role.name,
          date: roleStart, // Position based on role start
          startDate: roleCheckIn,
          endDate: roleEnd,
          description: `Role active from ${format(roleStart, "h:mm a")} to ${format(roleEnd, "h:mm a")}`,
          icon: <GanttChart className="h-5 w-5" />,
          isPassed: isAfter(now, roleEnd),
          isCurrent: isRoleActiveCurrent,
          category: category,
          children: [
            {
              id: `role-${roleIndex}-checkin`,
              title: "Check-in Begins",
              date: roleCheckIn,
              startDate: roleCheckIn,
              endDate: roleStart,
              description: format(roleCheckIn, "h:mm a"),
              icon: <UserCheck className="size-4" />,
              isPassed: isAfter(now, roleStart),
              isCurrent: isRoleCheckinCurrent,
              category: category,
            },
            {
              id: `role-${roleIndex}-event`,
              title: "Role Active",
              date: roleStart,
              startDate: roleStart,
              endDate: roleEnd,
              description: `${format(roleStart, "h:mm a")} - ${format(roleEnd, "h:mm a")}`,
              icon: <Clock className="size-4" />,
              isPassed: isAfter(now, roleEnd),
              isCurrent: isRoleActiveCurrent,
              details: (
                <div className="mt-2 bg-muted/40 rounded-md p-3">
                  <div className="flex items-center">
                    <UsersRound className="size-4 mr-2 text-muted-foreground" />
                    <span className="text-sm">
                      {role.volunteers} volunteer spots
                    </span>
                  </div>
                </div>
              ),
              category: category,
            },
          ],
        };
        newMilestones.push(roleMilestone);

        // Create Attendance Milestone for "All Events" tab
        newMilestones.push({
          id: `attendance-all-role-${roleIndex}`,
          title: `Attendance: ${role.name}`,
          date: roleEnd,
          startDate: roleEnd,
          endDate: roleEditDeadline,
          description: `Update attendance for ${role.name} role.`,
          icon: <ClipboardList className="h-5 w-5" />,
          isPassed: isAfter(now, roleEditDeadline),
          isCurrent: isRoleAttendanceCurrent,
          category: "all",
          children: [
            {
              id: `attendance-deadline-all-role-${roleIndex}`,
              title: "Deadline",
              date: roleEditDeadline,
              startDate: roleEditDeadline,
              description: format(roleEditDeadline, "MMMM d, yyyy, h:mm a"),
              icon: <CalendarCheck className="size-4" />,
              isPassed: isAfter(now, roleEditDeadline),
              isCurrent: false,
              category: "all",
            },
          ],
        });

        // Create Attendance Milestone for Role-Specific Tab
        newMilestones.push({
          id: `attendance-role-${roleIndex}`,
          title: `Attendance Reporting`,
          date: roleEnd,
          startDate: roleEnd,
          endDate: roleEditDeadline,
          description: "Update volunteer attendance records.",
          icon: <ClipboardList className="h-5 w-5" />,
          isPassed: isAfter(now, roleEditDeadline),
          isCurrent: isRoleAttendanceCurrent,
          category: category,
          children: [
            {
              id: `attendance-deadline-role-${roleIndex}`,
              title: "Deadline",
              date: roleEditDeadline,
              startDate: roleEditDeadline,
              description: `Submit by ${format(roleEditDeadline, "MMMM d, yyyy, h:mm a")}`,
              icon: <CalendarCheck className="size-4" />,
              isPassed: isAfter(now, roleEditDeadline),
              isCurrent: false,
              category: category,
            },
          ],
        });
      });

      // Sort event day children for "all" tab
      eventDayChildren.sort((a, b) => a.date.getTime() - b.date.getTime());

      // Add Event Day milestone for "all" tab
      newMilestones.push({
        id: "event-day-multi-role",
        title: "Event Day",
        date: earliestCheckInOverall, // Position based on earliest activity
        startDate: earliestCheckInOverall,
        endDate: latestEndOverall,
        description: format(eventDate, "EEEE, MMMM d, yyyy"),
        icon: <Calendar className="h-5 w-5" />,
        isPassed: isAfter(now, latestEndOverall),
        isCurrent: isEventDayCurrent,
        category: "all",
        children: eventDayChildren,
      });

      // Add Project Completion milestone
      newMilestones.push({
        id: "completion-multi-role",
        title: "Project Completion",
        date: latestDeadlineOverall,
        startDate: latestDeadlineOverall,
        description: "All activities completed and records finalized.",
        icon: <CheckCheck className="h-5 w-5" />,
        isPassed: isAfter(now, latestDeadlineOverall),
        isCurrent: isAfter(now, latestDeadlineOverall),
        category: "all",
      });
    }

    // Sort all milestones by their primary date for correct vertical order
    newMilestones.sort((a, b) => a.date.getTime() - b.date.getTime());

    // Removed progress calculation call
    // setCurrentProgress(progress);

    setMilestones(newMilestones);
  }, [
    currentTimestamp, // Only depend on the timestamp, not the Date object
    project.id,
    project.event_type,
    project.schedule,
    project.created_at,
    project.pause_signups,
  ]); // Remove createdDate since it's derived from project.created_at

  // Filter milestones for the active tab
  const filteredMilestones = useMemo(() => {
    return milestones.filter((milestone) =>
      activeTab === "all"
        ? milestone.category === "all"
        : milestone.category === activeTab,
    );
  }, [milestones, activeTab]);

  const eventTypeLabel =
    project.event_type === "oneTime"
      ? "One-time event"
      : project.event_type === "multiDay"
        ? "Multi-day event"
        : project.event_type === "sameDayMultiArea"
          ? "Multi-role event"
          : null;

  // Get formatted event dates
  const getFormattedEventDates = () => {
    if (project.event_type === "oneTime" && project.schedule.oneTime) {
      return format(getProjectStartDateTime(project), "EEEE, MMMM d, yyyy");
    } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
      const firstDay = new Date(project.schedule.multiDay[0].date);
      const lastDay = new Date(
        project.schedule.multiDay[project.schedule.multiDay.length - 1].date,
      );
      return `${format(firstDay, "MMM d")} - ${format(lastDay, "MMM d, yyyy")}`;
    } else if (
      project.event_type === "sameDayMultiArea" &&
      project.schedule.sameDayMultiArea
    ) {
      return format(
        new Date(project.schedule.sameDayMultiArea.date),
        "EEEE, MMMM d, yyyy",
      );
    }
    return "Date not specified";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenAction}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Project timeline</DialogTitle>
          <DialogDescription>
            View the complete lifecycle of your project from creation to
            completion
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {eventTypeLabel ? (
              <Badge variant="outline">{eventTypeLabel}</Badge>
            ) : null}
            <Badge variant="secondary">
              <Calendar aria-hidden="true" />
              {getFormattedEventDates()}
            </Badge>
          </div>

          {/* Tabs for multi-day or multi-role events */}
          {tabs.length > 1 && (
            <Tabs defaultValue="all" onValueChange={setActiveTab}>
              <TabsList className="w-full justify-start">
                {tabs.map((tab) => (
                  <TabsTrigger
                    key={tab.id}
                    value={tab.id}
                    className="min-w-fit flex-none"
                  >
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          <Timeline data-testid="timeline-container">
            {filteredMilestones.map((milestone, index) => {
              const status = milestone.isCurrent
                ? "current"
                : milestone.isPassed
                  ? "passed"
                  : "future";
              return (
                <TimelineItem
                  key={`${milestone.id}-${milestone.category}`}
                  status={status}
                  className="group"
                >
                  {index < filteredMilestones.length - 1 && (
                    <TimelineConnector />
                  )}

                  <TimelineHeader>
                    <TimelineIcon status={status}>
                      {milestone.icon}
                    </TimelineIcon>
                    <div className="grid flex-1 gap-0.5">
                      <TimelineTitle>{milestone.title}</TimelineTitle>
                      <p className="text-muted-foreground text-sm">
                        {milestone.startDate &&
                        milestone.endDate &&
                        !isSameDay(milestone.startDate, milestone.endDate)
                          ? `${format(milestone.startDate, "MMM d")} - ${format(milestone.endDate, "MMM d, yyyy")}`
                          : format(
                              milestone.date,
                              isSameDay(milestone.date, now)
                                ? "'Today,' MMMM d, yyyy"
                                : "MMMM d, yyyy",
                            )}
                      </p>
                    </div>
                  </TimelineHeader>

                  <TimelineContent className="grid gap-3">
                    <p className="text-muted-foreground text-sm">
                      {milestone.description}
                    </p>

                    {milestone.children && milestone.children.length > 0 && (
                      <ul className="grid gap-3 border-l pl-4">
                        {milestone.children.map((event) => {
                          const reached = event.isCurrent || event.isPassed;
                          return (
                            <li
                              key={event.id}
                              className={cn(
                                "flex items-start gap-3",
                                !reached && "text-muted-foreground",
                              )}
                            >
                              <span
                                className={cn(
                                  "flex size-6 shrink-0 items-center justify-center rounded-full",
                                  reached
                                    ? "bg-primary/10 text-primary"
                                    : "bg-muted",
                                  event.isCurrent && "ring-primary/40 ring-2",
                                )}
                              >
                                {event.icon}
                              </span>
                              <div className="grid flex-1 gap-0.5">
                                <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
                                  {event.title}
                                  {event.startDate && event.endDate && (
                                    <span className="text-muted-foreground font-normal tabular-nums">
                                      {format(event.startDate, "h:mm a")} -{" "}
                                      {format(event.endDate, "h:mm a")}
                                    </span>
                                  )}
                                </p>
                                {!event.startDate && !event.endDate && (
                                  <p className="text-muted-foreground text-sm">
                                    {event.description}
                                  </p>
                                )}
                                {event.details}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {project.pause_signups &&
                      milestone.id.startsWith("signup") && (
                        <Alert variant="warning">
                          <AlertTriangle aria-hidden="true" />
                          <AlertDescription>
                            Sign-ups are currently paused by project coordinator
                          </AlertDescription>
                        </Alert>
                      )}
                  </TimelineContent>
                </TimelineItem>
              );
            })}
          </Timeline>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline">Close</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
