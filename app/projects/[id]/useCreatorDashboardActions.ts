"use client";
import { safeConsole } from "@/lib/safe-console";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { Project } from "@/types";
import { cloneProject, updateProjectStatus } from "./actions";

/** Organizer actions that do not navigate: cancel, clone, email, calendar. */
export function useCreatorDashboardActions({
  project,
  canSyncProjectCalendar,
  onCancelled,
}: {
  project: Project;
  canSyncProjectCalendar: boolean;
  onCancelled: () => void;
}) {
  const router = useRouter();
  const [isCloning, startCloning] = useTransition();
  const setShowCancelDialog = (open: boolean) => {
    if (!open) onCancelled();
  };
  const [isCalendarSynced, setIsCalendarSynced] = useState(
    !!project.creator_calendar_event_id && !!project.creator_synced_at,
  );

  // Auto-sync calendar on page load if user is connected and project isn't synced
  useEffect(() => {
    const autoSyncCalendar = async () => {
      if (!canSyncProjectCalendar) return;

      // Only sync if not already synced
      if (isCalendarSynced) return;

      try {
        // Check if user is connected to Google Calendar
        const response = await fetch("/api/calendar/connection-status");
        const data = await response.json();

        if (data.connected) {
          // Sync project to calendar
          const syncResponse = await fetch("/api/calendar/sync-project", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project_id: project.id }),
          });

          if (syncResponse.ok) {
            toast.success("Project synced to Google Calendar");
            setIsCalendarSynced(true);
          }
        }
      } catch (error) {
        safeConsole.error("Auto calendar sync failed:", error);
      }
    };

    autoSyncCalendar();
  }, [project.id, isCalendarSynced, canSyncProjectCalendar]);

  const handleCancelProject = async (reason: string) => {
    try {
      const result = await updateProjectStatus(project.id, "cancelled", reason);
      if (result.error) {
        toast.error(result.error);
      } else {
        const notificationStatus = result.cancellationNotifications;
        if (notificationStatus?.enqueued) {
          toast.success(
            "Project cancelled successfully. Approved volunteers will be emailed shortly.",
          );
          if (notificationStatus.error) {
            toast.warning(notificationStatus.error);
          }
        } else {
          toast.success("Project cancelled successfully.");
          toast.warning(
            notificationStatus?.error ||
              "We couldn't queue cancellation emails. Please try again shortly.",
          );
        }
        setShowCancelDialog(false);
        router.refresh();
      }
    } catch {
      toast.error("Failed to cancel project");
    }
  };

  const handleClone = () => {
    startCloning(async () => {
      try {
        const result = await cloneProject(project.id);
        if (result.success && result.newProjectId) {
          toast.success("Project cloned successfully as draft!");
          router.push(`/projects/${result.newProjectId}/edit`);
        } else {
          toast.error(result.error || "Failed to clone project");
        }
      } catch {
        toast.error("An unexpected error occurred while cloning.");
      }
    });
  };

  const handleContactAllSignups = async () => {
    try {
      const supabase = createClient();
      const { data: signups, error } = await supabase
        .from("project_signups")
        .select(
          `
          user_id,
          profiles!inner(email, full_name)
        `,
        )
        .eq("project_id", project.id)
        .not("profiles.email", "is", null);

      if (error) {
        safeConsole.log("Error fetching signups:", error);
        safeConsole.error("Error fetching signups:", error);
        toast.error("Failed to fetch signup emails" + error.message);
        return;
      }

      if (!signups || signups.length === 0) {
        toast.error("No signups found for this project");
        return;
      }

      // Extract emails from the signups
      const emails = signups
        .map(
          (signup: {
            profiles: { email: string | null } | { email: string | null }[];
          }) => {
            const profile = Array.isArray(signup.profiles)
              ? signup.profiles[0]
              : signup.profiles;
            return profile?.email;
          },
        )
        .filter((email) => email) // Remove any null/undefined emails
        .join(",");

      if (!emails) {
        toast.error("No valid email addresses found");
        return;
      }

      // Create mailto link
      const subject = encodeURIComponent(`Update regarding: ${project.title}`);
      const body = encodeURIComponent(
        `Dear volunteers,\n\nI hope this message finds you well. I wanted to reach out regarding the upcoming volunteer project "${project.title}".\n\n[Please add your message here]\n\nThank you for your commitment to this project!\n\nBest regards,\n[Your name]`,
      );
      const mailtoLink = `mailto:?bcc=${emails}&subject=${subject}&body=${body}`;

      // Open email client
      window.location.href = mailtoLink;

      toast.success(
        `Opening email client with ${signups.length} volunteer emails`,
      );
    } catch (_error) {
      safeConsole.error("Error fetching signups:", _error);
      toast.error("Failed to fetch signup emails");
    }
  };

  return {
    isCloning,
    isCalendarSynced,
    setIsCalendarSynced,
    handleCancelProject,
    handleClone,
    handleContactAllSignups,
  };
}
