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
    const handlePendingSync = async () => {
      const pendingSyncData = sessionStorage.getItem("pendingCalendarSync");
      const redirectUrl = sessionStorage.getItem("calendarRedirectUrl");
      const modalState = sessionStorage.getItem("signupModalState");
      const shouldReopenModal = sessionStorage.getItem("reopenCalendarModal");
      
      // If we should reopen the calendar modal, don't process the sync here
      // The modal will handle it when it opens
      if (shouldReopenModal === "true") {
        // Clear the pending sync since the modal will handle the sync action
        sessionStorage.removeItem("pendingCalendarSync");
        
        // Redirect back to the original page
        if (redirectUrl) {
          sessionStorage.removeItem("calendarRedirectUrl");
          router.push(redirectUrl);
        }
        return;
      }
      
      // Handle signup modal reopen
      if (modalState) {
        const { projectId, scheduleId, returnToModal } = JSON.parse(modalState);
        sessionStorage.removeItem("signupModalState");
        
        if (returnToModal) {
          // Set a flag that the modal should check
          sessionStorage.setItem("calendarJustConnected", "true");
          
          // Redirect back to the project page which will reopen the modal
          router.push(`/projects/${projectId}`);
          return;
        }
      }
      
      if (!pendingSyncData) {
        return;
      }

      try {
        const { type, signupId, projectId, scheduleId } = JSON.parse(pendingSyncData);
        
        // Clear the pending sync immediately to prevent duplicate attempts
        sessionStorage.removeItem("pendingCalendarSync");

        if (type === "signup" && signupId && projectId && scheduleId) {
          // Sync volunteer signup - use correct parameter names (snake_case)
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

          // Redirect back to the project page
          if (redirectUrl) {
            sessionStorage.removeItem("calendarRedirectUrl");
            router.push(redirectUrl);
          }
          
        } else if (type === "project" && projectId) {
          // Sync creator project
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

          // Redirect back to the original page
          if (redirectUrl) {
            sessionStorage.removeItem("calendarRedirectUrl");
            router.push(redirectUrl);
          }
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
        
        // Still redirect back even on error
        const redirectUrl = sessionStorage.getItem("calendarRedirectUrl");
        if (redirectUrl) {
          sessionStorage.removeItem("calendarRedirectUrl");
          setTimeout(() => router.push(redirectUrl), 2000);
        }
      }
    };

    // Run after a short delay to ensure the page has loaded
    const timeout = setTimeout(handlePendingSync, 500);
    
    return () => clearTimeout(timeout);
  }, [router]);

  // This component doesn't render anything
  return null;
}
