"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import InitialOnboardingModal from "@/components/onboarding/InitialOnboardingModal";
import FirstLoginTour from "@/components/onboarding/FirstLoginTour";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { useAuth } from "@/hooks/useAuth";
import { createClient } from "@/lib/supabase/client";

export default function GlobalNotificationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isHomeRoute = pathname === "/home";
  const { user, loading: isLoading } = useAuth();
  const [showIntroTour, setShowIntroTour] = useState(false);
  const [homeRouteReady, setHomeRouteReady] = useState(false);
  const [introTourStarted, setIntroTourStarted] = useState(false);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [currentUserFullName, setCurrentUserFullName] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [autoJoinedOrg, setAutoJoinedOrg] = useState<{ id: string; name: string } | null>(null);
  const onboardingCompletedRef = useRef(false);
  const introCompletedRef = useRef(false);

  const suppressOnboardingModal = !!(
    pathname?.startsWith("/projects/create") ||
    pathname?.startsWith("/organization/create")
  );

  useEffect(() => {
    if (!isHomeRoute || typeof window === "undefined") {
      setHomeRouteReady(false);
      return;
    }

    let rafId: number | null = null;
    let timeoutId: number | null = null;
    let cancelled = false;

    const waitForGreeting = () => {
      if (cancelled) return;

      const greeting = document.querySelector("[data-tour-id='home-greeting']");
      if (greeting) {
        setHomeRouteReady(true);
        return;
      }

      rafId = window.requestAnimationFrame(waitForGreeting);
    };

    setHomeRouteReady(false);
    waitForGreeting();

    timeoutId = window.setTimeout(() => {
      if (!cancelled) {
        setHomeRouteReady(true);
      }
    }, 1500);

    return () => {
      cancelled = true;
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      setHomeRouteReady(false);
    };
  }, [isHomeRoute]);

  const markIntroTourComplete = useCallback(async () => {
    try {
      const { markIntroTourAsComplete } = await import("@/components/onboarding/onboarding-actions");
      const result = await markIntroTourAsComplete();

      if (result.error) {
        console.error("Failed to mark intro tour complete via server action:", result.error);
        return;
      }

      const supabase = createClient();
      const { data: { user: updatedUser }, error } = await supabase.auth.getUser();

      if (error) {
        console.warn("Error fetching updated user after tour complete:", error);
      }

      // Auth state is managed by useAuth hook automatically via onAuthStateChange
      if (updatedUser && process.env.NODE_ENV === 'development') {
        console.log('[GlobalNotificationProvider] User updated after tour complete:', updatedUser.email);
      }
    } catch (error) {
      console.error("Unexpected error updating intro tour status:", error);
    }
  }, []);

  const prepareOnboardingModal = useCallback(() => {
    if (!user) return;
    setCurrentUserFullName(
      user.user_metadata?.full_name || user.email?.split("@")[0] || "User"
    );
    setCurrentUserEmail(user.email || null);

    // Check for auto-joined organization
    const autoJoinedOrgId = user.user_metadata?.auto_joined_org_id;
    const autoJoinedOrgName = user.user_metadata?.auto_joined_org_name;
    if (autoJoinedOrgId && autoJoinedOrgName) {
      setAutoJoinedOrg({ id: autoJoinedOrgId, name: autoJoinedOrgName });
    } else {
      setAutoJoinedOrg(null);
    }
  }, [user]);

  const handleIntroComplete = useCallback(async () => {
    introCompletedRef.current = true;
    setShowIntroTour(false);
    setIntroTourStarted(false);
    await markIntroTourComplete();

    const needsProfile =
      !onboardingCompletedRef.current &&
      user?.user_metadata?.has_completed_onboarding !== true;

    if (needsProfile && !suppressOnboardingModal) {
      prepareOnboardingModal();
      setShowOnboardingModal(true);
    }
  }, [markIntroTourComplete, prepareOnboardingModal, suppressOnboardingModal, user]);

  useEffect(() => {
    if (!user) {
      setShowIntroTour(false);
      setShowOnboardingModal(false);
      onboardingCompletedRef.current = false;
      introCompletedRef.current = false;
      setIntroTourStarted(false);
      return;
    }

    const onboardingCompleted = user.user_metadata?.has_completed_onboarding === true;
    const introCompleted = user.user_metadata?.has_completed_intro_tour === true;

    // Only update refs if server says true, otherwise keep local optimistic state
    if (onboardingCompleted) onboardingCompletedRef.current = true;
    if (introCompleted) introCompletedRef.current = true;

    // Use the ref as the source of truth (combines server + local optimistic)
    const isIntroEffectiveComplete = introCompletedRef.current;

    // Priority 1: Tour (Only on Home)
    // We only attempt to show the tour if:
    // 1. It's not effectively complete
    // 2. We're not in a suppressed route
    // 3. AND we are on the Home page
    const canShowTourOnThisRoute = !isIntroEffectiveComplete && !suppressOnboardingModal && isHomeRoute;

    if (canShowTourOnThisRoute) {
      // Condition A: Tour is already active -> allow it to continue
      if (showIntroTour) {
        setShowOnboardingModal(false);
        return;
      }

      // Condition B: We are on Home and ready to start the tour -> Start it
      if (homeRouteReady && !introTourStarted) {
        setIntroTourStarted(true);
        setShowIntroTour(true);
        setShowOnboardingModal(false);
        return;
      }
    }

    // Priority 2: Onboarding Modal (Any page)
    // If we reach here, the Tour is NOT showing (either finished, skipped, invalid context, or not on home)
    setShowIntroTour(false);
    setIntroTourStarted(false);

    if (!onboardingCompletedRef.current && !suppressOnboardingModal) {
      prepareOnboardingModal();
      setShowOnboardingModal(true);
    } else {
      setShowOnboardingModal(false);
    }
  }, [
    user,
    suppressOnboardingModal,
    prepareOnboardingModal,
    homeRouteReady,
    introTourStarted,
    showIntroTour,
  ]);

  useEffect(() => {
    if (suppressOnboardingModal) {
      setShowOnboardingModal(false);
      if (showIntroTour) {
        setShowIntroTour(false);
      }
    }
  }, [suppressOnboardingModal, showIntroTour]);

  return (
    <NotificationProvider>
      {showIntroTour && user?.id && !isLoading && !suppressOnboardingModal && (
        <FirstLoginTour
          isOpen={showIntroTour}
          onComplete={handleIntroComplete}
          onSkip={handleIntroComplete}
        />
      )}
      {showOnboardingModal && user?.id && !isLoading && !suppressOnboardingModal && (
        <InitialOnboardingModal
          isOpen={showOnboardingModal}
          onClose={() => {
            setShowOnboardingModal(false);
            onboardingCompletedRef.current = true;
            console.log("Onboarding modal closed by user.");
            setTimeout(() => {
              // Trigger any higher-level refreshes if needed
            }, 500);
          }}
          userId={user.id}
          currentFullName={currentUserFullName}
          currentEmail={currentUserEmail}
          autoJoinedOrg={autoJoinedOrg}
        />
      )}
      {children}
    </NotificationProvider>
  );
}
