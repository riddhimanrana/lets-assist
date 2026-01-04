"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/hooks/use-toast";

/**
 * Handles pending calendar syncs after OAuth callback.
 * When a user tries to add an event to calendar but isn't connected,
 * we store the pending sync in sessionStorage and redirect to OAuth.
 * After OAuth completes, this component picks up the pending sync and executes it.
 */
export default function CalendarOAuthCallbackHandler() {
  const router = useRouter();

  useEffect(() => {
    const sync = async (syncData: any) => {
      try {
        const { type, signupId, projectId, scheduleId } = syncData;

        if (type === "signup" && signupId && projectId && scheduleId) {
          const response = await fetch("/api/calendar/add-signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              signup_id: signupId, 
              project_id: projectId,
              schedule_id: scheduleId 
            }),
          });

          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || "Failed to sync signup");
          }

          toast({
            title: "✓ Success!",
            description: "Event added to your Google Calendar",
            duration: 5000,
          });
        } else if (type === "project" && projectId) {
          const response = await fetch("/api/calendar/sync-project", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId }),
          });

          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || "Failed to sync project");
          }

          toast({
            title: "✓ Project Synced",
            description: "Your project has been synced to Google Calendar",
            duration: 5000,
          });
        }
      } catch (error) {
        console.error("Failed to handle pending calendar sync:", error);
        toast({
          title: "Calendar Sync Failed",
          description:
            error instanceof Error
              ? error.message
              : "Failed to sync event to calendar",
          variant: "destructive",
        });
      }
    };

    const handlePendingSync = async () => {
      const pendingSyncDataString = sessionStorage.getItem("pendingCalendarSync");
      const redirectUrl = sessionStorage.getItem("calendarRedirectUrl");

      if (pendingSyncDataString) {
        const pendingSyncData = JSON.parse(pendingSyncDataString);
        sessionStorage.removeItem("pendingCalendarSync");
        await sync(pendingSyncData);
      }

      if (redirectUrl) {
        sessionStorage.removeItem("calendarRedirectUrl");
        router.push(redirectUrl);
      }
    };

    const timeout = setTimeout(handlePendingSync, 500);
    
    return () => clearTimeout(timeout);
  }, [router]);

  // This component doesn't render anything
  return null;
}
