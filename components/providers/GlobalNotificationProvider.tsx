"use client";

import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import InitialOnboardingModal from "@/components/onboarding/InitialOnboardingModal";
import FirstLoginTour from "@/components/onboarding/FirstLoginTour";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { useAuth } from "@/hooks/useAuth";
import { createClient } from "@/lib/supabase/client";

function GlobalNotificationProviderInner({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isHomeRoute = pathname === "/home";
  // ... rest of the component body ...
  const { user, loading: isLoading } = useAuth();
  const [showIntroTour, setShowIntroTour] = useState(false);
  const [homeRouteReady, setHomeRouteReady] = useState(false);
  const [introTourStarted, setIntroTourStarted] = useState(false);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [pendingOnboardingAfterTour, setPendingOnboardingAfterTour] = useState(false);
  const [currentUserFullName, setCurrentUserFullName] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [autoJoinedOrg, setAutoJoinedOrg] = useState<{ id: string; name: string } | null>(null);
  const onboardingCompletedRef = useRef(false);
  const introCompletedRef = useRef(false);

  const restrictedPathsForLoggedInUsers = useRef([
    "/",
    "/login",
    "/signup",
    "/reset-password",
    "/faq",
  ]).current;

  const noRedirect = searchParams.get("noRedirect") === "1";
  const isRestrictedPath = !!pathname && restrictedPathsForLoggedInUsers.includes(pathname);
  const shouldRedirectHome = !!user && !isLoading && isRestrictedPath && !noRedirect;

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

  useEffect(() => {
    if (!shouldRedirectHome) return;

    setShowIntroTour(false);
    setShowOnboardingModal(false);

    if (pathname !== "/home") {
      router.replace("/home");
    }
  }, [pathname, router, shouldRedirectHome]);

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

    if (!needsProfile) {
      return;
    }

    setPendingOnboardingAfterTour(true);

    if (!suppressOnboardingModal && !isHomeRoute) {
      router.replace("/home");
      return;
    }

    if (!suppressOnboardingModal && isHomeRoute) {
      prepareOnboardingModal();
      setShowOnboardingModal(true);
      setPendingOnboardingAfterTour(false);
    }
  }, [isHomeRoute, markIntroTourComplete, prepareOnboardingModal, router, suppressOnboardingModal, user]);

  useEffect(() => {
    if (shouldRedirectHome) {
      setShowIntroTour(false);
      setShowOnboardingModal(false);
      setIntroTourStarted(false);
      setPendingOnboardingAfterTour(false);
      return;
    }

    if (!user) {
      setShowIntroTour(false);
      setShowOnboardingModal(false);
      onboardingCompletedRef.current = false;
      introCompletedRef.current = false;
      setIntroTourStarted(false);
      setPendingOnboardingAfterTour(false);
      return;
    }

    const onboardingCompleted = user.user_metadata?.has_completed_onboarding === true;
    const introCompleted = user.user_metadata?.has_completed_intro_tour === true;

    // Only update refs if server says true, otherwise keep local optimistic state
    if (onboardingCompleted) onboardingCompletedRef.current = true;
    if (introCompleted) introCompletedRef.current = true;

    // Use the ref as the source of truth (combines server + local optimistic)
    const isIntroEffectiveComplete = introCompletedRef.current;
    const isTourActive = !isIntroEffectiveComplete && introTourStarted;

    if (isTourActive) {
      if (!showIntroTour) {
        setShowIntroTour(true);
      }
      setShowOnboardingModal(false);
      return;
    }

    if (pendingOnboardingAfterTour && !suppressOnboardingModal && isHomeRoute) {
      prepareOnboardingModal();
      setShowOnboardingModal(true);
      setPendingOnboardingAfterTour(false);
      return;
    }

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

    // Priority 2: Onboarding Modal (Only on Home)
    // If we reach here, the Tour is NOT showing (either finished, skipped, invalid context, or not on home)
    if (showIntroTour) {
      setShowIntroTour(false);
    }

    if (!onboardingCompletedRef.current && !suppressOnboardingModal && isHomeRoute) {
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
    isHomeRoute,
    pendingOnboardingAfterTour,
    shouldRedirectHome,
  ]);

  useEffect(() => {
    if (suppressOnboardingModal || !isHomeRoute) {
      setShowOnboardingModal(false);
    }
  }, [isHomeRoute, suppressOnboardingModal]);

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

export default function GlobalNotificationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={children}>
      <GlobalNotificationProviderInner>{children}</GlobalNotificationProviderInner>
    </Suspense>
  );
}
