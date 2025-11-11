"use client";

import InitialOnboardingModal from "@/components/InitialOnboardingModal";
import { useEffect, useState, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import { NotificationListener } from "./NotificationListener";
import { useAuth } from "@/hooks/useAuth";

export default function GlobalNotificationProvider({ 
  children 
}: { 
  children: React.ReactNode 
}) {
  const pathname = usePathname();
  const { user, isLoading } = useAuth(); // Use centralized auth hook instead of manual getUser()
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [currentUserFullName, setCurrentUserFullName] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const onboardingCompletedRef = useRef(false); // Guard to prevent re-showing modal

  // Do not show onboarding modal on critical creation flows where it can block inputs
  const suppressOnboardingModal = !!(
    pathname?.startsWith("/projects/create") ||
    pathname?.startsWith("/organization/create")
  );

  // Simplified onboarding check—only look at the metadata flag
  useEffect(() => {
    if (!user) {
      setShowOnboardingModal(false);
      onboardingCompletedRef.current = false;
      return;
    }

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
  }, [user, suppressOnboardingModal]);

  // If user navigates into a suppressed route while the modal is open, hide it
  useEffect(() => {
    if (suppressOnboardingModal && showOnboardingModal) {
      setShowOnboardingModal(false);
    }
  }, [suppressOnboardingModal, showOnboardingModal]);

  // Force refresh user status (called after onboarding completion)
  const forceRefreshUserStatus = useCallback(async () => {
    // useAuth hook handles caching automatically - just clear and restart
    // This is handled by the auth context, no manual refresh needed
  }, []);
  
  return (
    <>
      {user?.id && <NotificationListener userId={user.id} />}
      {showOnboardingModal && user?.id && !isLoading && !suppressOnboardingModal && (
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
          userId={user.id}
          currentFullName={currentUserFullName}
          currentEmail={currentUserEmail}
        />
      )}
      {children}
    </>
  );
}
