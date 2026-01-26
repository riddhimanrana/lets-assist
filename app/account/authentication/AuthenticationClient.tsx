"use client";

import { useState, useEffect, Suspense } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { useSearchParams, useRouter } from "next/navigation";

function AuthenticationContent() {
  const { user } = useAuth(); // Use centralized auth hook
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const [linkedGoogleEmail, setLinkedGoogleEmail] = useState<string | null>(
    null,
  );
  const supabase = createClient();

  // Unified function to check connection status using the most reliable source
  const checkGoogleConnection = async () => {
    if (!user) return;

    try {
      const { data: identitiesData, error } = await supabase.auth.getUserIdentities();

      if (error) {
        console.error("Error fetching identities:", error);
        return;
      }

      const identities = identitiesData?.identities || [];
      const googleIdentity = identities.find(
        (identity) => identity.provider === "google",
      );

      if (googleIdentity) {
        setIsGoogleConnected(true);
        const email = googleIdentity.identity_data?.email;
        setLinkedGoogleEmail(typeof email === "string" ? email : null);
      } else {
        setIsGoogleConnected(false);
        setLinkedGoogleEmail(null);
      }
    } catch (err) {
      console.error("Check connection exception:", err);
    }
  };

  useEffect(() => {
    const error = searchParams.get("error");
    const success = searchParams.get("success");

    if (error === "linking_failed") {
      toast.error("Failed to link Google account. It may already be connected to another account.");
      router.replace("/account/authentication");
    } else if (success === "linked") {
      toast.success("Google account connected successfully!");
      // Force a re-check after successful link
      checkGoogleConnection();
      router.replace("/account/authentication");
    }
  }, [searchParams, router]);

  useEffect(() => {
    if (user) {
      checkGoogleConnection();
    } else {
      setIsGoogleConnected(false);
      setLinkedGoogleEmail(null);
    }
  }, [user]);

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
            login_hint: user?.email || "",
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

      const identities = identitiesData.identities;
      const googleIdentity = identities.find(
        (identity) => identity.provider === "google",
      );

      if (!googleIdentity) {
        toast.error("Google account not found or already disconnected.");
        setIsGoogleConnected(false);
        setIsConnecting(false);
        return;
      }

      // Instead of just checking length, make sure they have at least one other login method
      const otherIdentities = identities.filter(id => id.id !== googleIdentity.id);

      if (otherIdentities.length === 0) {
        toast.error("Cannot disconnect your only sign-in method. Please set a password or connect another account first.");
        setIsConnecting(false);
        return;
      }

      const { error: unlinkError } =
        await supabase.auth.unlinkIdentity(googleIdentity);

      if (unlinkError) throw unlinkError;

      // Trigger re-check to update local UI after disconnect
      await checkGoogleConnection();

      toast.success("Google account disconnected successfully.");
      setIsGoogleConnected(false);
      setLinkedGoogleEmail(null); // Clear the linked email
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
        <Card className="border shadow-xs">
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
        <Card className="border shadow-xs">
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

export default function AuthenticationClient() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <AuthenticationContent />
    </Suspense>
  );
}