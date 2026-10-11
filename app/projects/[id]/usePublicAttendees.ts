"use client";
import { safeConsole } from "@/lib/safe-console";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "@/types";
import { createClient } from "@/lib/supabase/client";
import type { SlotAttendee } from "@/components/projects/SlotAttendeesDropdown";
import { EMPTY_DEMO_ATTENDEES } from "./project-details-types";
import { canReadProjectRoster, groupProjectRoster } from "./project-roster";

export type RosterLoadState = "loading" | "ready" | "error" | "restricted";

/** Loads only the attendee list the existing server RPC authorizes. */
export function usePublicAttendees({
  project,
  canManageProject,
  demoMode,
  demoPublicAttendees,
}: {
  project: Project;
  canManageProject: boolean;
  demoMode: boolean;
  demoPublicAttendees: SlotAttendee[];
}) {
  const [publicAttendees, setPublicAttendees] = useState<SlotAttendee[]>(
    demoMode ? demoPublicAttendees : EMPTY_DEMO_ATTENDEES,
  );
  const [rosterState, setRosterState] = useState<RosterLoadState>("loading");
  const requestRef = useRef(0);
  const shouldFetch = canReadProjectRoster(project, canManageProject);

  const refetchAttendees = useCallback(async () => {
    const request = ++requestRef.current;
    if (!shouldFetch) {
      setPublicAttendees(EMPTY_DEMO_ATTENDEES);
      setRosterState("restricted");
      return;
    }
    if (demoMode) {
      setPublicAttendees(demoPublicAttendees);
      setRosterState("ready");
      return;
    }
    setRosterState("loading");
    try {
      const { data, error } = await createClient().rpc("get_public_attendees", {
        p_project_id: project.id,
      });
      if (request !== requestRef.current) return;
      if (error) throw error;
      setPublicAttendees(data || EMPTY_DEMO_ATTENDEES);
      setRosterState("ready");
    } catch (error) {
      if (request !== requestRef.current) return;
      safeConsole.error("Error fetching attendees:", error);
      setPublicAttendees(EMPTY_DEMO_ATTENDEES);
      setRosterState("error");
    }
  }, [project.id, shouldFetch, demoMode, demoPublicAttendees]);

  useEffect(() => {
    setPublicAttendees(EMPTY_DEMO_ATTENDEES);
    void refetchAttendees();
    return () => {
      requestRef.current++;
    };
  }, [refetchAttendees]);

  const roster = useMemo(
    () => groupProjectRoster(project, canManageProject, publicAttendees),
    [project, canManageProject, publicAttendees],
  );
  const getAttendeesForSlot = (scheduleId: string): SlotAttendee[] =>
    roster.slots.get(scheduleId) ?? EMPTY_DEMO_ATTENDEES;

  return {
    getAttendeesForSlot,
    previousScheduleAttendees: roster.previousSchedule,
    rosterState,
    refetchAttendees,
  };
}
