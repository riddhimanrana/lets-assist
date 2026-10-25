"use client";
import { safeConsole } from "@/lib/safe-console";

import { useCallback, useEffect, useState } from "react";
import type { Project, WaiverDefinitionFull } from "@/types";
import type { AuthUser } from "@/lib/supabase/types";
import { createClient } from "@/lib/supabase/client";
import { getProjectWaiver } from "./actions";
import type { SlotData } from "./project-details-types";

type SignupStatusRow = { id: string; schedule_id: string };

/**
 * Per-slot signup state for the viewer: what is left, what they hold, and what
 * was rejected or attended. Also loads the waiver the signup forms need.
 */
export function useProjectSignupState({
  project,
  user,
  initialSlotData,
}: {
  project: Project;
  user: AuthUser | null;
  initialSlotData: SlotData;
}) {
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>(
    {},
  );
  const [remainingSlots, setRemainingSlots] = useState<Record<string, number>>(
    initialSlotData.remainingSlots,
  );
  const [hasSignedUp, setHasSignedUp] = useState<Record<string, boolean>>(
    initialSlotData.userSignups,
  );
  const [rejectedSlots, setRejectedSlots] = useState<Record<string, boolean>>(
    initialSlotData.rejectedSlots || {},
  );
  const [attendedSlots, setAttendedSlots] = useState<Record<string, boolean>>(
    initialSlotData.attendedSlots || {},
  );
  const [pendingSlots, setPendingSlots] = useState<Record<string, boolean>>(
    initialSlotData.pendingSlots || {},
  );
  const [waiverDefinition, setWaiverDefinition] =
    useState<WaiverDefinitionFull | null>(null);
  // The signing dialog must not start until the project's real waiver form is
  // known. A waiver project starts as "loading", never as "ready".
  const [waiverDefinitionStatus, setWaiverDefinitionStatus] = useState<
    "loading" | "ready" | "error"
  >(project.waiver_required ? "loading" : "ready");
  const expectsWaiverDefinition = Boolean(
    (project as { waiver_definition_id?: string | null }).waiver_definition_id,
  );
  const [waiverDefinitionAttempt, setWaiverDefinitionAttempt] = useState(0);
  const retryWaiverDefinition = useCallback(() => {
    setWaiverDefinitionAttempt((attempt) => attempt + 1);
  }, []);
  const [completedSignup, setCompletedSignup] = useState<{
    signupId: string;
    scheduleId: string;
  } | null>(null);

  useEffect(() => {
    async function checkPreviousRejections() {
      if (user) {
        const supabase = createClient();

        // Query for all rejected signups for this user and project
        const { data: rejectedData, error: rejectedError } = (await supabase
          .from("project_signups")
          .select("id, schedule_id")
          .eq("project_id", project.id)
          .eq("user_id", user.id)
          .eq("status", "rejected")) as {
          data: SignupStatusRow[] | null;
          error: { message: string } | null;
        };

        if (rejectedError) {
          safeConsole.error("Error checking for rejections:", rejectedError);
        } else if (rejectedData && rejectedData.length > 0) {
          // Create a record of rejected slots
          const rejections: Record<string, boolean> = {};
          rejectedData.forEach((rejection) => {
            rejections[rejection.schedule_id] = true;
          });

          // Update state with rejected slots
          setRejectedSlots(rejections);
        }

        // Query for all attended signups for this user and project
        const { data: attendedData, error: attendedError } = (await supabase
          .from("project_signups")
          .select("id, schedule_id")
          .eq("project_id", project.id)
          .eq("user_id", user.id)
          .eq("status", "attended")) as {
          data: SignupStatusRow[] | null;
          error: { message: string } | null;
        };

        if (attendedError) {
          safeConsole.error(
            "Error checking for attended status:",
            attendedError,
          );
        } else if (attendedData && attendedData.length > 0) {
          // Create a record of attended slots
          const attended: Record<string, boolean> = {};
          attendedData.forEach((slot) => {
            attended[slot.schedule_id] = true;
          });

          // Update state with attended slots
          setAttendedSlots(attended);
          // Capture a completed signup for calendar modal and certificate display
          setCompletedSignup({
            signupId: attendedData[0].id,
            scheduleId: attendedData[0].schedule_id,
          });
        }
      } else {
        // Clear rejected and attended slots if user logs out
        setRejectedSlots({});
        setAttendedSlots({});
        setPendingSlots({});
      }
    }

    checkPreviousRejections();
  }, [user, project.id]);

  useEffect(() => {
    if (!project.waiver_required) {
      setWaiverDefinitionStatus("ready");
      return;
    }
    let isMounted = true;
    setWaiverDefinitionStatus("loading");

    const fetchWaiverConfig = async () => {
      try {
        const result = await getProjectWaiver(project.id);
        if (!isMounted) return;

        if (result.error) {
          safeConsole.error("Error fetching waiver config:", result.error);
          setWaiverDefinitionStatus("error");
          return;
        }

        const definition =
          (result.definition as WaiverDefinitionFull | null) ?? null;
        // A project with no saved definition is a valid, loaded answer. One
        // that points at a definition and came back without it is not.
        setWaiverDefinition(definition);
        setWaiverDefinitionStatus(
          expectsWaiverDefinition && !definition ? "error" : "ready",
        );
      } catch (error) {
        safeConsole.error("Error fetching waiver configuration:", error);
        if (isMounted) setWaiverDefinitionStatus("error");
      }
    };

    fetchWaiverConfig();

    return () => {
      isMounted = false;
    };
  }, [
    project.id,
    project.waiver_required,
    expectsWaiverDefinition,
    waiverDefinitionAttempt,
  ]);

  return {
    loadingStates,
    setLoadingStates,
    remainingSlots,
    setRemainingSlots,
    hasSignedUp,
    setHasSignedUp,
    rejectedSlots,
    attendedSlots,
    pendingSlots,
    waiverDefinition,
    waiverDefinitionStatus,
    retryWaiverDefinition,
    completedSignup,
  };
}
