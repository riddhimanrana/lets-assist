'use client';

import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import InitialOnboardingModal from "./InitialOnboardingModal";
import { createClient } from "@/utils/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export default function OnboardingDebugButton() {
  const { user } = useAuth(); // Use centralized auth hook
  const [showModal, setShowModal] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userFullName, setUserFullName] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [showDebugInfo, setShowDebugInfo] = useState(false);

  const checkCurrentUserState = async () => {
    if (!user?.id) {
      setDebugInfo({ error: "No user logged in" });
      return;
    }

    const supabase = createClient();
    const { data: profileData } = await supabase
      .from("profiles")
      .select("username, created_at, phone")
      .eq("id", user.id)
      .single();
    
    const debugData = {
      userId: user.id,
      email: user.email,
      userMetadata: user.user_metadata,
      hasCompletedOnboarding: user.user_metadata?.has_completed_onboarding,
      profileData,
      hasUsername: profileData?.username && profileData.username.trim().length > 0,
      accountAge: profileData?.created_at ? 
        Math.round((new Date().getTime() - new Date(profileData.created_at).getTime()) / (1000 * 60)) + ' minutes' : 'unknown'
    };
    
    setDebugInfo(debugData);
    console.log("Current user debug info:", debugData);
  };

  const handleOpenModal = () => {
    if (user) {
      setUserId(user.id);
      setUserFullName(user.user_metadata?.full_name || user.email?.split("@")[0] || "Test User");
      setUserEmail(user.email || null);
      setShowModal(true);
    } else {
      // Mock data for testing when not logged in
      setUserId("test-user-id");
      setUserFullName("Test User");
      setUserEmail("test@example.com");
      setShowModal(true);
    }
  };

  const forceResetOnboardingFlag = async () => {
    if (!user?.id) return;

    const supabase = createClient();
    
    // Reset the onboarding flag to false to test
    await supabase.auth.updateUser({
      data: { has_completed_onboarding: false }
    });
    
    console.log("Reset onboarding flag to false for testing");
    alert("Reset onboarding flag - refresh page to test");
    checkCurrentUserState(); // Refresh debug info
  };

  useEffect(() => {
    if (user?.id) {
      checkCurrentUserState();
    }
  }, [user?.id]);

  return (
    <>
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        <Button 
          variant="outline" 
          onClick={handleOpenModal}
          className="bg-red-500 text-white hover:bg-red-600"
          size="sm"
        >
          🐛 Test Modal
        </Button>
        
        <Button 
          variant="outline" 
          onClick={() => setShowDebugInfo(!showDebugInfo)}
          className="bg-blue-500 text-white hover:bg-blue-600"
          size="sm"
        >
          {showDebugInfo ? '📊 Hide' : '📊 Debug'}
        </Button>
        
        <Button 
          variant="outline" 
          onClick={checkCurrentUserState}
          className="bg-green-500 text-white hover:bg-green-600"
          size="sm"
        >
          � Refresh
        </Button>

        <Button 
          variant="outline" 
          onClick={forceResetOnboardingFlag}
          className="bg-yellow-500 text-white hover:bg-yellow-600"
          size="sm"
        >
          🔄 Reset Onboarding
        </Button>
      </div>
      
      {showDebugInfo && debugInfo && (
        <div className="fixed bottom-20 right-4 z-50 bg-black text-white p-4 rounded-lg text-xs max-w-xs max-h-96 overflow-auto">
          <pre>{JSON.stringify(debugInfo, null, 2)}</pre>
        </div>
      )}
      
      {showModal && userId && (
        <InitialOnboardingModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          userId={userId}
          currentFullName={userFullName}
          currentEmail={userEmail}
        />
      )}
    </>
  );
}
