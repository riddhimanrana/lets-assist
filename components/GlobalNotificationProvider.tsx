"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import InitialOnboardingModal from "@/components/InitialOnboardingModal";
import FirstLoginTour from "@/components/FirstLoginTour";
import { NotificationListener } from "./NotificationListener";
import { useAuth } from "@/hooks/useAuth";
import { createClient } from "@/utils/supabase/client";
import { updateCachedUser } from "@/utils/auth/auth-context";

export default function GlobalNotificationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isHomeRoute = pathname === "/home";
  const { user, isLoading } = useAuth();
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
      const supabase = createClient();
      const { data, error } = await supabase.auth.updateUser({
        data: { has_completed_intro_tour: true },
      });

      if (error) {
        console.error("Failed to mark intro tour complete:", error);
        return;
      }

      if (data?.user) {
        updateCachedUser(data.user);
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

    onboardingCompletedRef.current = onboardingCompleted;
    introCompletedRef.current = introCompleted;

    if (!introCompleted && !suppressOnboardingModal) {
      if (!introTourStarted) {
        if (!homeRouteReady && !showIntroTour) {
          return;
        }
        setIntroTourStarted(true);
      }

      setShowIntroTour(true);
      setShowOnboardingModal(false);
      return;
    }

    setShowIntroTour(false);
    setIntroTourStarted(false);

    if (!onboardingCompleted && !suppressOnboardingModal) {
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
    <>
      {user?.id && <NotificationListener userId={user.id} />}
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
    </>
  );
}
