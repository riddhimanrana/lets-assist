"use client";

import InitialOnboardingModal from "@/components/InitialOnboardingModal";
import { createClient } from "@/utils/supabase/client";
import { useEffect, useState, useRef } from "react";
import { NotificationListener } from "./NotificationListener";

export default function GlobalNotificationProvider({ 
  children 
}: { 
  children: React.ReactNode 
}) {
  const [userId, setUserId] = useState<string | null>(null);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [currentUserFullName, setCurrentUserFullName] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const initRef = useRef(false);
  const onboardingCheckRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const supabase = createClient();

    // 1) Subscribe to auth changes first so we catch SIGNED_IN immediately
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, _session) => {
        if (['SIGNED_IN','TOKEN_REFRESHED','USER_UPDATED'].includes(event)) {
          onboardingCheckRef.current = false;
          // Always fetch the user from the server for authenticity
          const { data: { user }, error } = await supabase.auth.getUser();
          if (user) {
            setUserId(user.id);
            await checkOnboardingStatus(user, true);
          } else {
            setUserId(null);
            setShowOnboardingModal(false);
            setCurrentUserFullName(null);
            setCurrentUserEmail(null);
            onboardingCheckRef.current = false;
          }
        } else if (event === 'SIGNED_OUT') {
          setUserId(null);
          setShowOnboardingModal(false);
          setCurrentUserFullName(null);
          setCurrentUserEmail(null);
          onboardingCheckRef.current = false;
        }
      }
    );

    // 2) Simplified onboarding check—only look at the metadata flag
    const checkOnboardingStatus = async (user: any, forceCheck = false) => {
      if (!user) return;
      if (!forceCheck && onboardingCheckRef.current) return;
      onboardingCheckRef.current = true;

      const completed = user.user_metadata?.has_completed_onboarding === true;
      if (completed) {
        setShowOnboardingModal(false);
      } else {
        setCurrentUserFullName(
          user.user_metadata?.full_name ||
          user.email?.split("@")[0] ||
          "User"
        );
        setCurrentUserEmail(user.email || null);
        setShowOnboardingModal(true);
      }
    };

    // 3) Initial fetch after listener is ready
    const getUserIdAndCheckOnboarding = async () => {
      try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error) {
          console.error("Error fetching user in GlobalNotificationProvider:", error);
          setUserId(null);
          setShowOnboardingModal(false);
          onboardingCheckRef.current = false;
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
          onboardingCheckRef.current = false;
        }
      } catch (err) {
        console.error("Exception in getUserIdAndCheckOnboarding:", err);
        setUserId(null);
        setShowOnboardingModal(false);
        onboardingCheckRef.current = false;
      }
    };
    getUserIdAndCheckOnboarding();

    return () => {
      authListener?.subscription.unsubscribe();
      initRef.current = false;
      onboardingCheckRef.current = false;
    };
  }, []);
  
  return (
    <>
      {userId && <NotificationListener userId={userId} />}
      {showOnboardingModal && userId && (
        <InitialOnboardingModal
          isOpen={showOnboardingModal}
          onClose={() => {
            setShowOnboardingModal(false);
            console.log("Onboarding modal closed by user.");
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
