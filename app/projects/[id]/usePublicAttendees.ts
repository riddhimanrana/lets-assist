"use client";
import { safeConsole } from "@/lib/safe-console";

import { useEffect, useState } from "react";
import type { Project } from "@/types";
import { createClient } from "@/lib/supabase/client";
import type { SlotAttendee } from "@/components/projects/SlotAttendeesDropdown";
import { EMPTY_DEMO_ATTENDEES } from "./project-details-types";

/** Loads the attendee list a viewer is allowed to see, grouped per slot. */
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

  useEffect(() => {
    const fetchPublicAttendees = async () => {
      if (demoMode) {
        setPublicAttendees(demoPublicAttendees);
        return;
      }

      // Fetch if public OR if user is a manager
      const shouldFetch = project.show_attendees_publicly || canManageProject;

      if (!shouldFetch) {
        setPublicAttendees((current) =>
          current.length === 0 ? current : EMPTY_DEMO_ATTENDEES,
        );
        return;
      }

      // If not a manager, check visibility
      if (
        !canManageProject &&
        project.visibility !== "public" &&
        project.visibility !== "unlisted"
      ) {
        setPublicAttendees((current) =>
          current.length === 0 ? current : EMPTY_DEMO_ATTENDEES,
        );
        return;
      }

      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_public_attendees", {
        p_project_id: project.id,
      });

      if (error) {
        safeConsole.error("Error fetching attendees:", error);
        setPublicAttendees([]);
        return;
      }

      setPublicAttendees(data || []);
    };

    fetchPublicAttendees();
  }, [
    project.id,
    project.show_attendees_publicly,
    project.visibility,
    canManageProject,
    demoMode,
    demoPublicAttendees,
  ]);

  // Function to refetch attendees (called after signup/cancel)
  const refetchAttendees = async () => {
    if (demoMode) {
      setPublicAttendees(demoPublicAttendees);
      return;
    }

    const shouldFetch = project.show_attendees_publicly || canManageProject;
    if (!shouldFetch) return;

    if (
      !canManageProject &&
      project.visibility !== "public" &&
      project.visibility !== "unlisted"
    )
      return;

    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_public_attendees", {
      p_project_id: project.id,
    });

    if (error) {
      safeConsole.error("Error refetching attendees:", error);
      return;
    }

    setPublicAttendees(data || []);
  };

  // Helper function to get attendees for a specific schedule slot
  const getAttendeesForSlot = (scheduleId: string): SlotAttendee[] => {
    // Show to managers even if not public
    if (!project.show_attendees_publicly && !canManageProject) return [];
    return publicAttendees.filter(
      (attendee) => attendee.schedule_id === scheduleId,
    );
  };

  return { getAttendeesForSlot, refetchAttendees };
}
