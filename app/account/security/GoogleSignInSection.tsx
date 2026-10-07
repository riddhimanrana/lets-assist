"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Unlink } from "lucide-react";
import { toast } from "sonner";
import { startGoogleIdentityLink } from "@/app/account/authentication/google-link";
import { SettingsSection } from "@/components/layout/SettingsSection";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { createClient } from "@/lib/supabase/client";
import { SECURITY_PAGE_PATH } from "./use-two-factor";

/**
 * Google as a sign-in method. Also owns the toast for the link callback, which
 * returns here with ?success=linked or ?error=linking_failed.
 */
export function GoogleSignInSection() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [mounted, setMounted] = useState(false);
  const [hasCheckedConnection, setHasCheckedConnection] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const [linkedGoogleEmail, setLinkedGoogleEmail] = useState<string | null>(
    null,
  );
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const checkGoogleConnection = useCallback(async () => {
    if (!user) {
      return;
    }

    try {
      const { data: identitiesData, error } =
        await supabase.auth.getUserIdentities();

      if (error) {
        console.error("Error fetching identities:", error);
        return;
      }

      const identities = identitiesData?.identities ?? [];
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
    } catch (error) {
      console.error("Check connection exception:", error);
    } finally {
      setHasCheckedConnection(true);
    }
  }, [supabase, user]);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    const error = searchParams.get("error");
    const success = searchParams.get("success");

    if (error === "linking_failed") {
      toast.error(
        "Failed to link Google account. It may already be connected to another account.",
      );
      router.replace(SECURITY_PAGE_PATH);
      return;
    }

    if (success === "linked") {
      toast.success("Google account connected successfully!");
      void checkGoogleConnection();
      router.replace(SECURITY_PAGE_PATH);
    }
  }, [checkGoogleConnection, mounted, router, searchParams]);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    if (!user) {
      setIsGoogleConnected(false);
      setLinkedGoogleEmail(null);
      return;
    }

    void checkGoogleConnection();
  }, [checkGoogleConnection, mounted, user]);

  const handleGoogleLink = async () => {
    setIsConnecting(true);

    try {
      const result = await startGoogleIdentityLink(supabase.auth, undefined, {
        loginHint: user?.email || "",
      });

      if (result.redirected) return;

      if (result.error) {
        throw result.error;
      }

      toast.info("Redirecting to Google to link your account...");
    } catch {
      console.error("Google account linking failed");
      toast.error("Failed to link Google account. Please try again.");
      setIsConnecting(false);
    }
  };

  const handleGoogleDisconnect = async () => {
    setIsConnecting(true);

    try {
      const { data: identitiesData, error: identitiesError } =
        await supabase.auth.getUserIdentities();

      if (identitiesError) {
        throw identitiesError;
      }

      if (!identitiesData?.identities) {
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

      const otherIdentities = identities.filter(
        (identity) => identity.id !== googleIdentity.id,
      );

      if (otherIdentities.length === 0) {
        toast.error(
          "Cannot disconnect your only sign-in method. Please set a password or connect another account first.",
        );
        setIsConnecting(false);
        return;
      }

      const { error: unlinkError } =
        await supabase.auth.unlinkIdentity(googleIdentity);

      if (unlinkError) {
        throw unlinkError;
      }

      await checkGoogleConnection();

      toast.success("Google account disconnected successfully.");
      setIsGoogleConnected(false);
      setLinkedGoogleEmail(null);
    } catch (error) {
      console.error("Error disconnecting Google account:", error);
      toast.error(
        `Failed to disconnect Google account. ${error instanceof Error ? error.message : "Please try again."}`,
      );
    } finally {
      setIsConnecting(false);
    }
  };

  const handleConfirmDisconnect = async () => {
    await handleGoogleDisconnect();
    setShowDisconnectDialog(false);
  };

  return (
    <>
      <SettingsSection
        title="Google sign-in"
        description="Sign in with your Google account instead of a password."
      >
        <Item className="px-0 py-0">
          <ItemMedia>
            <Image
              src="/resources/google-logo-2026.png"
              alt=""
              width={24}
              height={24}
              className="size-6 object-contain"
            />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle>
              Google
              {hasCheckedConnection && isGoogleConnected && (
                <Badge variant="success">Connected</Badge>
              )}
            </ItemTitle>
            <ItemDescription className="break-all">
              {!hasCheckedConnection
                ? "Checking connection..."
                : isGoogleConnected
                  ? (linkedGoogleEmail ?? "Connected")
                  : "Not connected"}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            {!hasCheckedConnection ? (
              <Skeleton className="h-9 w-24" />
            ) : isGoogleConnected ? (
              <Button
                variant="ghost"
                onClick={() => setShowDisconnectDialog(true)}
                disabled={isConnecting}
                aria-label="Disconnect Google Account"
              >
                {isConnecting ? "Disconnecting..." : "Disconnect"}
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={handleGoogleLink}
                disabled={isConnecting}
                aria-label="Connect Google Account"
              >
                {isConnecting ? "Connecting..." : "Connect"}
              </Button>
            )}
          </ItemActions>
        </Item>
        <p className="text-muted-foreground text-sm">
          This is for signing in. Calendar sync is set up under{" "}
          <Link
            href="/account/calendar"
            className="text-foreground underline underline-offset-4"
          >
            Calendar
          </Link>
          .
        </p>
      </SettingsSection>

      <AlertDialog
        open={showDisconnectDialog}
        onOpenChange={(open) => {
          if (!open && !isConnecting) {
            setShowDisconnectDialog(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive">
              <Unlink className="size-5" />
            </AlertDialogMedia>
            <AlertDialogTitle>Disconnect Google?</AlertDialogTitle>
            <AlertDialogDescription>
              {linkedGoogleEmail
                ? `You will no longer be able to sign in with ${linkedGoogleEmail}. You can connect it again later.`
                : "You will no longer be able to sign in with Google. You can connect it again later."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isConnecting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmDisconnect();
              }}
              disabled={isConnecting}
            >
              {isConnecting ? "Disconnecting..." : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
