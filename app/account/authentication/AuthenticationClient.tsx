"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/utils/supabase/client";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";

export default function AuthenticationClient() {
  const { user } = useAuth(); // Use centralized auth hook
  const [isConnecting, setIsConnecting] = useState(false);
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const [linkedGoogleEmail, setLinkedGoogleEmail] = useState<string | null>(
    null,
  );
  const supabase = createClient();
  
  useEffect(() => {
    if (user) {
      checkGoogleConnection();
    }
  }, [user]); // Changed dependency from [] to [user]
  
  const checkGoogleConnection = () => {
    if (!user?.identities) {
      setIsGoogleConnected(false);
      return;
    }

    const googleIdentity = user.identities.find(
      (identity) => identity.provider === "google",
    );
    if (googleIdentity) {
      setIsGoogleConnected(true);
      // Supabase stores provider-specific data in identity_data
      // For Google, this typically includes an 'email' field.
      const email = googleIdentity.identity_data?.email;
      if (typeof email === "string") {
        setLinkedGoogleEmail(email);
      } else {
        // Fallback or further investigation needed if email isn't directly available
        // This might happen if the identity_data is structured differently or email is missing
        console.warn("Google identity found, but email not in identity_data.email. Attempting to use user.email if it matches provider.");
        // As a fallback, if the primary user email is from google, we can assume it.
        // This is less direct but can be a placeholder.
        // A more robust solution might involve calling getUserIdentities() for richer data if needed.
        if (user.email && googleIdentity.user_id === user.id) { // Check if this identity belongs to the current user
           // Heuristic: if user.email exists and this identity is for this user, it might be the one.
           // However, user.email is the primary email, not necessarily the Google linked one if they differ.
           // For now, we'll prefer the direct identity_data.email.
           setLinkedGoogleEmail(null); // Or set to user.email if logic dictates
        } else {
          setLinkedGoogleEmail(null);
        }
      }
    } else {
      setIsGoogleConnected(false);
      setLinkedGoogleEmail(null);
    }
  };

  const handleGoogleLink = async () => {
    setIsConnecting(true);
    try {
      const { error } = await supabase.auth.linkIdentity({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?from=authentication`,
          queryParams: {
            access_type: "offline",
            prompt: "consent",
          },
        },
      });
      if (error) throw error;
      // Redirect will happen, or handle error if no redirect URL (though linkIdentity doesn't return a URL directly like signInWithOAuth)
      // For linkIdentity, Supabase handles the redirect. We might need to refresh state upon return via callback.
      // For now, we assume the redirect happens and state is updated on page reload or via the callback handler.
      toast.info("Redirecting to Google to link your account...");
    } catch (error) {
      console.error("Error linking Google account:", error);
      toast.error(
        `Failed to link Google account. ${error instanceof Error ? error.message : "Please try again."}`,
      );
      setIsConnecting(false); // Only set to false on error, as success means redirect
    }
    // setIsConnecting(false) will be handled by page navigation or if an error occurs.
  };

  const handleGoogleDisconnect = async () => {
    setIsConnecting(true);
    try {
      const { data: identitiesData, error: identitiesError } =
        await supabase.auth.getUserIdentities();

      if (identitiesError) throw identitiesError;

      if (!identitiesData || !identitiesData.identities) {
        throw new Error("Could not retrieve user identities.");
      }
      
      if (identitiesData.identities.length < 2) {
        toast.error("Cannot disconnect the last linked identity. You need at least two identities (e.g., email and Google) to unlink one.");
        setIsConnecting(false);
        return;
      }

      const googleIdentity = identitiesData.identities.find(
        (identity) => identity.provider === "google",
      );

      if (!googleIdentity) {
        toast.error("Google account not found or already disconnected.");
        setIsGoogleConnected(false); // Correct the state if it's desynced
        setIsConnecting(false);
        return;
      }

      const { error: unlinkError } =
        await supabase.auth.unlinkIdentity(googleIdentity);

      if (unlinkError) throw unlinkError;

      toast.success("Google account disconnected successfully.");
      setIsGoogleConnected(false);
      setLinkedGoogleEmail(null); // Clear the linked email
      // Optionally, call checkGoogleConnection() again to be absolutely sure
      // await checkGoogleConnection(); 
    } catch (error) {
      console.error("Error disconnecting Google account:", error);
      toast.error(
        `Failed to disconnect Google account. ${error instanceof Error ? error.message : "Please try again."}`,
      );
    } finally {
      setIsConnecting(false);
    }
  };
  
  const handleGoogleConnect = async () => {
    if (isGoogleConnected) {
      await handleGoogleDisconnect();
    } else {
      await handleGoogleLink();
    }
  };
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 sm:p-6"
    >
      <div className="space-y-6 max-w-6xl">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Authentication
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage your connected accounts and sign-in methods
          </p>
        </div>
        <Card className="border shadow-sm">
          <CardHeader className="px-5 py-5">
            <CardTitle className="text-xl">Connected Accounts</CardTitle>
            <CardDescription>
              Connect your accounts for a seamless sign-in experience
            </CardDescription>
          </CardHeader>
          <CardContent className="px-5 py-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-3 sm:p-4 border rounded-lg">
              <div className="flex items-center space-x-4">
                <svg
                  className="h-5 w-5 sm:h-6 sm:w-6"
                  aria-hidden="true"
                  focusable="false"
                  data-prefix="fab"
                  data-icon="google"
                  role="img"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 488 512"
                >
                  <path
                    fill="currentColor"
                    d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z"
                  />
                </svg>
                <div>
                  <h4 className="text-sm font-semibold">Google Account</h4>
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    {isGoogleConnected && linkedGoogleEmail
                      ? `Connected with Google: ${linkedGoogleEmail}`
                      : isGoogleConnected
                        ? "Your account is connected with Google." // Fallback if email isn't available
                        : "Connect your account with Google for easier sign-in."}
                  </p>
                </div>
              </div>
              <div>
                <Button
                  variant={isGoogleConnected ? "outline" : "default"}
                  onClick={handleGoogleConnect}
                  disabled={isConnecting}
                  className="w-full sm:w-auto"
                  aria-label={isGoogleConnected ? "Disconnect Google Account" : "Connect Google Account"}
                >
                  {isConnecting
                    ? isGoogleConnected ? "Disconnecting..." : "Connecting..."
                    : isGoogleConnected
                      ? "Disconnect"
                      : "Connect"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border shadow-sm">
          <CardHeader className="p-5">
            <CardTitle className="text-xl">Two-Factor Authentication</CardTitle>
            <CardDescription>
              Add an extra layer of security to your account
            </CardDescription>
          </CardHeader>
          <CardContent className="px-5 py-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-3 sm:p-4 border rounded-lg opacity-50">
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">Authenticator App</h4>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Use an authenticator app to generate two-factor codes
                </p>
              </div>
              <Button variant="outline" disabled className="w-full sm:w-auto">
                Coming Soon
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
}