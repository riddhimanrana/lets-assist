"use client";

import { useMemo, useState } from "react";
import { differenceInMinutes, format, isAfter, parseISO } from "date-fns";
import type { Project, ProjectSignup } from "@/types";
import { formatTimeTo12Hour } from "@/lib/utils";
import { getMultiDaySlotDisplayName } from "@/utils/project";

/**
 * Everything the hours tool knows about sessions: their names and phases,
 * which signups belong to each, and which are already published.
 */
export function useHoursSessions({
  project,
  signups,
  searchTerm,
  sessionFilter,
}: {
  project: Project;
  signups: ProjectSignup[];
  searchTerm: string;
  sessionFilter: string;
}) {
  // Keep session labels consistent across the review, publish, and certificate flows.
  const formatSessionName = (proj: Project, sessionId: string): string => {
    if (!proj) return sessionId; // Added missing return statement

    // One-time events
    if (
      proj.event_type === "oneTime" &&
      sessionId === "oneTime" &&
      proj.schedule.oneTime
    ) {
      const date = parseISO(proj.schedule.oneTime.date);
      const startTime = formatTimeTo12Hour(proj.schedule.oneTime.startTime);
      const endTime = formatTimeTo12Hour(proj.schedule.oneTime.endTime);
      return `${format(date, "MMMM d, yyyy")} (${startTime} - ${endTime})`;
    }

    // Multi-day events
    if (
      proj.event_type === "multiDay" &&
      sessionId.startsWith("day-") &&
      proj.schedule.multiDay
    ) {
      const parts = sessionId.split("-");
      if (parts.length >= 4) {
        const dayIndex = parseInt(parts[1], 10);
        const slotIndex = parseInt(parts[3], 10);

        if (
          proj.schedule.multiDay[dayIndex] &&
          proj.schedule.multiDay[dayIndex].slots[slotIndex]
        ) {
          const day = proj.schedule.multiDay[dayIndex];
          const slot = day.slots[slotIndex];
          const date = parseISO(day.date);
          const startTime = formatTimeTo12Hour(slot.startTime);
          const endTime = formatTimeTo12Hour(slot.endTime);
          const slotLabel = getMultiDaySlotDisplayName(slot, slotIndex);

          return `${format(date, "MMMM d, yyyy")} - ${slotLabel} (${startTime} - ${endTime})`;
        }
      }
    }

    // Same-day multi-area events
    if (
      proj.event_type === "sameDayMultiArea" &&
      sessionId.startsWith("role-") &&
      proj.schedule.sameDayMultiArea
    ) {
      const roleIndex = parseInt(sessionId.split("-")[1], 10);
      if (proj.schedule.sameDayMultiArea.roles[roleIndex]) {
        const role = proj.schedule.sameDayMultiArea.roles[roleIndex];
        const date = parseISO(proj.schedule.sameDayMultiArea.date);
        const startTime = formatTimeTo12Hour(role.startTime);
        const endTime = formatTimeTo12Hour(role.endTime);

        return `${format(date, "MMMM d, yyyy")} - ${role.name} (${startTime} - ${endTime})`;
      }
    }

    return sessionId; // Fallback if no formatting rules matched
  };

  // Group signups by session (similar to AttendanceClient)
  const signupsBySession = useMemo(() => {
    return signups.reduce(
      (acc, record) => {
        // Include both 'attended' and 'approved' signups with check-in data
        if (
          (record.status === "attended" || record.status === "approved") &&
          record.check_in_time
        ) {
          // Make sure we have a valid schedule_id
          const scheduleId = record.schedule_id || "unknown";

          if (!acc[scheduleId]) {
            acc[scheduleId] = [];
          }
          acc[scheduleId].push(record);
        }
        return acc;
      },
      {} as Record<string, ProjectSignup[]>,
    );
  }, [signups]);

  // Filter and sort signups (similar to AttendanceClient, but simpler sorting for now)
  const filteredSignupsBySession = useMemo(() => {
    let sessionData: Record<string, ProjectSignup[]> = {};
    if (sessionFilter === "all") {
      sessionData = { ...signupsBySession };
    } else {
      sessionData = { [sessionFilter]: signupsBySession[sessionFilter] || [] };
    }

    let filtered: Record<string, ProjectSignup[]> = {};
    if (!searchTerm) {
      filtered = { ...sessionData };
    } else {
      const searchLower = searchTerm.toLowerCase();
      Object.entries(sessionData).forEach(([session, sessionSignups]) => {
        const matchingSignups = sessionSignups.filter((record) => {
          // --- CORRECTED ACCESS ---
          const nameMatch = record.user_id
            ? record.profile?.full_name?.toLowerCase().includes(searchLower) ||
              false
            : record.anonymous_signup?.name
                ?.toLowerCase()
                .includes(searchLower) || false;
          const emailMatch = record.user_id
            ? record.profile?.email?.toLowerCase().includes(searchLower) ||
              false
            : record.anonymous_signup?.email
                ?.toLowerCase()
                .includes(searchLower) || false;
          // --- END CORRECTION ---
          return nameMatch || emailMatch;
        });
        if (matchingSignups.length > 0) {
          filtered[session] = matchingSignups;
        }
      });
    }
    // Basic sort by name for now
    Object.keys(filtered).forEach((session) => {
      if (filtered[session]) {
        // Add null check for filtered[session]
        filtered[session].sort((a, b) => {
          // --- CORRECTED ACCESS ---
          const nameA =
            (a.user_id ? a.profile?.full_name : a.anonymous_signup?.name) || "";
          const nameB =
            (b.user_id ? b.profile?.full_name : b.anonymous_signup?.name) || "";
          // --- END CORRECTION ---
          return nameA.localeCompare(nameB);
        });
      }
    });

    return filtered;
  }, [signupsBySession, searchTerm, sessionFilter]);

  // Get all possible sessions from the project
  const getAllProjectSessions = useMemo(() => {
    const sessions: {
      id: string;
      name: string;
      endDateTime: Date;
      status: "upcoming" | "in-progress" | "completed" | "editing";
      alternativeIds: string[];
    }[] = [];
    const now = new Date();

    if (project.event_type === "oneTime" && project.schedule.oneTime) {
      const date = parseISO(project.schedule.oneTime.date);
      const [endHours, endMinutes] = project.schedule.oneTime.endTime
        .split(":")
        .map(Number);
      const endDateTime = new Date(
        new Date(date).setHours(endHours, endMinutes),
      );

      // Determine status
      let status: "upcoming" | "in-progress" | "completed" | "editing" =
        "upcoming";
      if (isAfter(now, endDateTime)) {
        // Check if in editing window
        const hoursSinceEnd = differenceInMinutes(now, endDateTime) / 60;
        if (hoursSinceEnd < 48) {
          status = "editing";
        } else {
          status = "completed";
        }
      } else {
        const [startHours, startMinutes] = project.schedule.oneTime.startTime
          .split(":")
          .map(Number);
        const startDateTime = new Date(
          new Date(date).setHours(startHours, startMinutes),
        );
        if (isAfter(now, startDateTime)) {
          status = "in-progress";
        }
      }

      sessions.push({
        id: "oneTime",
        name: formatSessionName(project, "oneTime"),
        endDateTime,
        status,
        alternativeIds: ["0", "oneTime", "default"],
      });
    } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
      project.schedule.multiDay.forEach((day, dayIndex) => {
        const dayDate = parseISO(day.date);

        day.slots.forEach((slot, slotIndex) => {
          const sessionId = `${day.date}-${dayIndex}-${slotIndex}`;
          const [endHours, endMinutes] = slot.endTime.split(":").map(Number);
          const endDateTime = new Date(
            new Date(dayDate).setHours(endHours, endMinutes),
          );

          // Determine status
          let status: "upcoming" | "in-progress" | "completed" | "editing" =
            "upcoming";
          if (isAfter(now, endDateTime)) {
            // Check if in editing window
            const hoursSinceEnd = differenceInMinutes(now, endDateTime) / 60;
            if (hoursSinceEnd < 48) {
              status = "editing";
            } else {
              status = "completed";
            }
          } else {
            const [startHours, startMinutes] = slot.startTime
              .split(":")
              .map(Number);
            const startDateTime = new Date(
              new Date(dayDate).setHours(startHours, startMinutes),
            );
            if (isAfter(now, startDateTime)) {
              status = "in-progress";
            }
          }

          // Create alternative IDs that might be used in the database
          const simplifiedId = `${dayIndex}-${slotIndex}`;
          const dateString = format(dayDate, "yyyy-MM-dd");
          const dateBasedId = `${dateString}-${slotIndex}`;

          sessions.push({
            id: sessionId,
            name: formatSessionName(project, sessionId),
            endDateTime,
            status,
            alternativeIds: [simplifiedId, dateBasedId],
          });
        });
      });
    } else if (
      project.event_type === "sameDayMultiArea" &&
      project.schedule.sameDayMultiArea
    ) {
      const date = parseISO(project.schedule.sameDayMultiArea.date);

      project.schedule.sameDayMultiArea.roles.forEach((role) => {
        const [endHours, endMinutes] = role.endTime.split(":").map(Number);
        const endDateTime = new Date(
          new Date(date).setHours(endHours, endMinutes),
        );

        // Use role name directly as the session ID
        const sessionId = role.name;

        // Determine status
        let status: "upcoming" | "in-progress" | "completed" | "editing" =
          "upcoming";
        if (isAfter(now, endDateTime)) {
          const hoursSinceEnd = differenceInMinutes(now, endDateTime) / 60;
          if (hoursSinceEnd < 48) {
            status = "editing";
          } else {
            status = "completed";
          }
        } else {
          const [startHours, startMinutes] = role.startTime
            .split(":")
            .map(Number);
          const startDateTime = new Date(
            new Date(date).setHours(startHours, startMinutes),
          );
          if (isAfter(now, startDateTime)) {
            status = "in-progress";
          }
        }

        sessions.push({
          id: sessionId, // Use role name as ID
          name: formatSessionName(project, sessionId),
          endDateTime,
          status,
          alternativeIds: [sessionId], // The role name is the only ID we need
        });
      });
    }

    return sessions;
  }, [project]);

  // Add state to track published status from project
  const [publishedSessions, setPublishedSessions] = useState<
    Record<string, boolean>
  >(() => {
    // Initialize from project.published
    if (!project.published) return {};
    return project.published as Record<string, boolean>;
  });

  // Function to check if a session is published
  const isSessionPublished = (sessionId: string): boolean => {
    if (project.event_type === "oneTime") {
      return !!publishedSessions["oneTime"];
    } else if (project.event_type === "multiDay") {
      const publishKey = getPublishStateKey(sessionId);
      return !!publishedSessions[publishKey];
    } else if (project.event_type === "sameDayMultiArea") {
      // For multi-area events, use the sessionId directly as it's the role name
      return !!publishedSessions[sessionId];
    }
    return false;
  };

  // Function to get session identifier for publishing
  const getPublishStateKey = (sessionId: string): string => {
    if (project.event_type === "oneTime") {
      return "oneTime";
    } else if (project.event_type === "multiDay") {
      const parts = sessionId.split("-");
      if (parts.length === 5) {
        // New format: YYYY-MM-DD-dayIndex-slotIndex
        const dateKey = `${parts[0]}-${parts[1]}-${parts[2]}`;
        const slotIndex = parts[4];
        return `${dateKey}-${slotIndex}`;
      } else if (parts.length === 4) {
        // Legacy format: YYYY-MM-DD-slotIndex
        return sessionId;
      }
    } else if (project.event_type === "sameDayMultiArea") {
      // For multi-area events, the sessionId is already the role name
      return sessionId;
    }
    return sessionId;
  };

  // --- Filter active sessions for the header display - only show sessions in "editing" status that are unpublished ---
  const activeUnpublishedSessions = useMemo(() => {
    // First get all sessions in editing status from getAllProjectSessions
    const editingSessions = getAllProjectSessions.filter(
      (session) => session.status === "editing",
    );

    // Then filter out published sessions and add hoursRemaining calculation
    return editingSessions
      .filter((session) => !isSessionPublished(session.id))
      .map((session) => {
        // Calculate hours remaining (48 hour editing window)
        const now = new Date();
        const hoursSinceEnd =
          differenceInMinutes(now, session.endDateTime) / 60;
        const hoursRemaining = Math.max(0, 48 - hoursSinceEnd);

        return {
          ...session,
          hoursRemaining: Math.floor(hoursRemaining),
        };
      });
  }, [getAllProjectSessions, publishedSessions]);
  // --- End filter ---

  return {
    formatSessionName,
    signupsBySession,
    filteredSignupsBySession,
    getAllProjectSessions,
    publishedSessions,
    setPublishedSessions,
    isSessionPublished,
    getPublishStateKey,
    activeUnpublishedSessions,
  };
}

export type HoursSessions = ReturnType<typeof useHoursSessions>;
export type HoursSession = HoursSessions["getAllProjectSessions"][number];
