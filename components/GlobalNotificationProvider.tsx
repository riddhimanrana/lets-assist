"use client";

import InitialOnboardingModal from "@/components/InitialOnboardingModal";
import { createClient } from "@/utils/supabase/client";
import { useEffect, useState, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import { NotificationListener } from "./NotificationListener";

export default function GlobalNotificationProvider({ 
  children 
}: { 
  children: React.ReactNode 
}) {
  const pathname = usePathname();
  const [userId, setUserId] = useState<string | null>(null);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [currentUserFullName, setCurrentUserFullName] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const initRef = useRef(false);
  const onboardingCompletedRef = useRef(false); // Guard to prevent re-showing modal
  const authUnsubscribeRef = useRef<(() => void) | undefined>(undefined);

  // Do not show onboarding modal on critical creation flows where it can block inputs
  const suppressOnboardingModal = !!(
    pathname?.startsWith("/projects/create") ||
    pathname?.startsWith("/organization/create")
  );

  // Simplified onboarding check—only look at the metadata flag
  const checkOnboardingStatus = useCallback(async (user: any) => {
    if (!user) return;

    const completed = user.user_metadata?.has_completed_onboarding === true;
    
    // If onboarding was completed in this session, don't show modal again
    if (completed || onboardingCompletedRef.current) {
      setShowOnboardingModal(false);
      if (completed) {
        onboardingCompletedRef.current = true;
      }
    } else {
      // Only show modal if onboarding hasn't been completed in this session
      setCurrentUserFullName(
        user.user_metadata?.full_name ||
        user.email?.split("@")[0] ||
        "User"
      );
      setCurrentUserEmail(user.email || null);
      if (!suppressOnboardingModal) {
        setShowOnboardingModal(true);
      } else {
        // Ensure it stays hidden on suppressed routes
        setShowOnboardingModal(false);
      }
    }
  }, [suppressOnboardingModal]);

  // Function to check user authentication and onboarding status
  const checkUserStatus = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data: { user }, error } = await supabase.auth.getUser();
      
      if (error) {
        console.error("Error fetching user in GlobalNotificationProvider:", error);
        setUserId(null);
        setShowOnboardingModal(false);
        onboardingCompletedRef.current = false;
        setIsLoading(false);
        return;
      }
      
      if (user) {
        console.log("User fetched:", user.id);
        setUserId(user.id);
        await checkOnboardingStatus(user);
      } else {
        console.log("No active user session.");
        setUserId(null);
        setShowOnboardingModal(false);
        onboardingCompletedRef.current = false;
      }
      
      setIsLoading(false);
    } catch (err) {
      console.error("Exception in checkUserStatus:", err);
      setUserId(null);
      setShowOnboardingModal(false);
      onboardingCompletedRef.current = false;
      setIsLoading(false);
    }
  }, [checkOnboardingStatus]);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const supabase = createClient();

    // Initial check
    checkUserStatus();

    // Subscribe to auth state changes instead of polling
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, _session) => {
      // Debounce rapid changes by scheduling a microtask
      queueMicrotask(() => {
        checkUserStatus();
      });
    });
    authUnsubscribeRef.current = () => subscription.subscription.unsubscribe();

    return () => {
      try {
        authUnsubscribeRef.current?.();
      } catch {}
      initRef.current = false;
      onboardingCompletedRef.current = false;
    };
  }, [checkUserStatus]);

  // If user navigates into a suppressed route while the modal is open, hide it
  useEffect(() => {
    if (suppressOnboardingModal && showOnboardingModal) {
      setShowOnboardingModal(false);
    }
  }, [suppressOnboardingModal, showOnboardingModal]);

  // Force refresh user status (called after onboarding completion)
  const forceRefreshUserStatus = useCallback(async () => {
    await checkUserStatus();
  }, [checkUserStatus]);
  
  return (
    <>
      {userId && <NotificationListener userId={userId} />}
      {showOnboardingModal && userId && !isLoading && !suppressOnboardingModal && (
        <InitialOnboardingModal
          isOpen={showOnboardingModal}
          onClose={() => {
            setShowOnboardingModal(false);
            onboardingCompletedRef.current = true; // Mark as completed in this session
            console.log("Onboarding modal closed by user.");
            // Force refresh to ensure UI is updated
            setTimeout(() => {
              forceRefreshUserStatus();
            }, 500);
          }}
          userId={userId}
          currentFullName={currentUserFullName}
          currentEmail={currentUserEmail}
        />
      )}
      {children}
    </>
  );
}
