"use client";

import { REGEXP_ONLY_DIGITS } from "input-otp";
import { motion } from "framer-motion";
import {
  Copy,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Trash2,
} from "lucide-react";
import { QRCode } from "react-qrcode-logo";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import {
  buildMfaRedirectPath,
  deriveAuthenticatorAssurance,
  getMfaFactorLabel,
  getVerifiedTotpFactors,
  shouldPromptForMfaChallenge,
  type MfaFactorLike,
  type MfaListFactorsLike,
} from "@/lib/auth/mfa";
import { createClient } from "@/lib/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { toast } from "sonner";

type PendingTotpEnrollment = {
  id: string;
  friendlyName: string;
  qrCode: string;
  secret: string;
  uri: string;
};

function formatFactorMetadata(value?: string | null, prefix?: string) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return `${prefix ? `${prefix} ` : ""}${parsed.toLocaleString()}`;
}

function AuthenticationContent() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [mounted, setMounted] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const [linkedGoogleEmail, setLinkedGoogleEmail] = useState<string | null>(
    null,
  );
  const [isMfaLoading, setIsMfaLoading] = useState(true);
  const [mfaFactors, setMfaFactors] = useState<MfaFactorLike[]>([]);
  const [aalState, setAalState] = useState<{
    currentLevel: string | null;
    nextLevel: string | null;
  } | null>(null);
  const [pendingEnrollment, setPendingEnrollment] =
    useState<PendingTotpEnrollment | null>(null);
  const [enrollmentFriendlyName, setEnrollmentFriendlyName] = useState(
    "My authenticator app",
  );
  const [enrollmentCode, setEnrollmentCode] = useState("");
  const [isStartingEnrollment, setIsStartingEnrollment] = useState(false);
  const [isVerifyingEnrollment, setIsVerifyingEnrollment] = useState(false);
  const [isCancellingEnrollment, setIsCancellingEnrollment] = useState(false);
  const [factorToDisable, setFactorToDisable] = useState<MfaFactorLike | null>(
    null,
  );
  const [isDisablingFactor, setIsDisablingFactor] = useState(false);

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
    }
  }, [supabase, user]);

  const loadMfaState = useCallback(async () => {
    if (!user) {
      setIsMfaLoading(false);
      setMfaFactors([]);
      setAalState(null);
      setPendingEnrollment(null);
      return;
    }

    setIsMfaLoading(true);

    try {
      const [
        { data: factorsData, error: factorsError },
        { data: claimsData, error: claimsError },
      ] = await Promise.all([
        supabase.auth.mfa.listFactors(),
        supabase.auth.getClaims(),
      ]);

      if (factorsError) {
        throw factorsError;
      }

      if (claimsError) {
        console.error("Failed to load auth claims for MFA settings:", claimsError);
      }

      const factorData = (factorsData as MfaListFactorsLike | null) ?? null;

      // Silently remove any TOTP factors the user started enrolling but never
      // completed (status === "unverified"). These are orphaned whenever the
      // user abandons the setup flow (closes the tab, reloads, navigates away).
      // Cleaning them up here ensures the next "Set up authenticator" click
      // always works and never surfaces a spurious "already exists" error.
      const rawTotp = Array.isArray(factorData?.totp)
        ? factorData.totp
        : Array.isArray(factorData?.all)
          ? factorData.all.filter((f) => f.factor_type === "totp")
          : [];
      const unverified = rawTotp.filter((f) => f.status === "unverified");
      for (const factor of unverified) {
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }

      const assuranceData = deriveAuthenticatorAssurance(
        typeof claimsData?.claims?.aal === "string" ? claimsData.claims.aal : null,
        factorData,
      );

      setMfaFactors(
        getVerifiedTotpFactors(factorData),
      );
      setAalState({
        currentLevel: assuranceData?.currentLevel ?? null,
        nextLevel: assuranceData?.nextLevel ?? null,
      });
    } catch (error) {
      console.error("Failed to load MFA settings:", error);
      toast.error("We couldn't load your authenticator settings right now.");
      setMfaFactors([]);
      setAalState(null);
    } finally {
      setIsMfaLoading(false);
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
      router.replace("/account/authentication");
      return;
    }

    if (success === "linked") {
      toast.success("Google account connected successfully!");
      void checkGoogleConnection();
      router.replace("/account/authentication");
    }
  }, [checkGoogleConnection, mounted, router, searchParams]);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    if (!user) {
      setIsGoogleConnected(false);
      setLinkedGoogleEmail(null);
      setIsMfaLoading(false);
      setMfaFactors([]);
      setAalState(null);
      setPendingEnrollment(null);
      return;
    }

    void checkGoogleConnection();
    void loadMfaState();
  }, [checkGoogleConnection, loadMfaState, mounted, user]);

  const refreshSessionAfterMfaChange = useCallback(async () => {
    const { error } = await supabase.auth.refreshSession();

    if (error) {
      console.warn("Session refresh after MFA update failed:", error);
    }
  }, [supabase]);

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

      if (error) {
        throw error;
      }

      toast.info("Redirecting to Google to link your account...");
    } catch (error) {
      console.error("Error linking Google account:", error);
      toast.error(
        `Failed to link Google account. ${error instanceof Error ? error.message : "Please try again."}`,
      );
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

      const { error: unlinkError } = await supabase.auth.unlinkIdentity(
        googleIdentity,
      );

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

  const handleGoogleConnect = async () => {
    if (isGoogleConnected) {
      await handleGoogleDisconnect();
      return;
    }

    await handleGoogleLink();
  };

  const handleStartEnrollment = async () => {
    if (!user) {
      toast.error("You need to be signed in to configure an authenticator app.");
      return;
    }

    setIsStartingEnrollment(true);

    try {
      const friendlyName = enrollmentFriendlyName.trim() || "Authenticator App";
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName,
      });

      if (error || !data) {
        throw error ?? new Error("Supabase did not return an authenticator factor.");
      }

      setPendingEnrollment({
        id: data.id,
        friendlyName: data.friendly_name ?? friendlyName,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
        uri: data.totp.uri,
      });
      setEnrollmentCode("");

      toast.info(
        "Scan the QR code with your authenticator app, then enter the 6-digit code to finish setup.",
      );
    } catch (error) {
      console.error("Failed to enroll authenticator factor:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn't start authenticator setup right now.",
      );
    } finally {
      setIsStartingEnrollment(false);
    }
  };

  const handleCopySetupKey = async () => {
    if (!pendingEnrollment) {
      return;
    }

    try {
      await navigator.clipboard.writeText(pendingEnrollment.secret);
      toast.success("Setup key copied to your clipboard.");
    } catch {
      toast.error("Couldn't copy the setup key. You can still copy it manually.");
    }
  };

  const handleVerifyEnrollment = async () => {
    if (!pendingEnrollment) {
      return;
    }

    const normalizedCode = enrollmentCode.replace(/\s+/g, "").trim();
    if (normalizedCode.length !== 6) {
      toast.error("Enter the 6-digit code from your authenticator app.");
      return;
    }

    setIsVerifyingEnrollment(true);

    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: pendingEnrollment.id,
        code: normalizedCode,
      });

      if (error) {
        throw error;
      }

      await refreshSessionAfterMfaChange();
      setPendingEnrollment(null);
      setEnrollmentCode("");
      await loadMfaState();
      router.refresh();

      toast.success(
        "Authenticator app enabled. Future sign-ins will require a verification code.",
      );
    } catch (error) {
      console.error("Failed to verify authenticator factor:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "The code couldn't be verified. Please try again.",
      );
    } finally {
      setIsVerifyingEnrollment(false);
    }
  };

  const handleCancelEnrollment = async () => {
    if (!pendingEnrollment) {
      return;
    }

    setIsCancellingEnrollment(true);

    try {
      const { error } = await supabase.auth.mfa.unenroll({
        factorId: pendingEnrollment.id,
      });

      if (error) {
        throw error;
      }

      setPendingEnrollment(null);
      setEnrollmentCode("");
      await loadMfaState();
      toast.info("Authenticator setup canceled.");
    } catch (error) {
      console.error("Failed to cancel authenticator setup:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn't cancel authenticator setup right now.",
      );
    } finally {
      setIsCancellingEnrollment(false);
    }
  };

  const handleDisableFactor = async () => {
    if (!factorToDisable) {
      return;
    }

    if (aalState?.currentLevel !== "aal2") {
      toast.info("Please verify your identity before removing an authenticator.");
      router.push(buildMfaRedirectPath("/account/authentication"));
      setFactorToDisable(null);
      return;
    }

    setIsDisablingFactor(true);

    try {
      const { error } = await supabase.auth.mfa.unenroll({
        factorId: factorToDisable.id,
      });

      if (error) {
        throw error;
      }

      await refreshSessionAfterMfaChange();
      await loadMfaState();
      router.refresh();

      toast.success(
        `${getMfaFactorLabel(factorToDisable)} has been removed from your account.`,
      );
      setFactorToDisable(null);
    } catch (error) {
      console.error("Failed to remove authenticator factor:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn't remove the authenticator right now.",
      );
    } finally {
      setIsDisablingFactor(false);
    }
  };

  const mfaEnabled = mfaFactors.length > 0;
  const requiresStepUpVerification = shouldPromptForMfaChallenge(aalState, {
    totp: mfaFactors,
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 sm:p-6"
    >
      <div className="max-w-6xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Authentication
          </h1>
          <p className="mt-1 text-muted-foreground">
            Manage your connected accounts, sign-in methods, and authenticator app.
          </p>
        </div>

        <Card className="border shadow-xs">
          <CardHeader>
            <CardTitle className="text-xl">Connected Accounts</CardTitle>
            <CardDescription>
              Connect your accounts for a seamless sign-in experience.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
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
                  <p className="text-xs text-muted-foreground sm:text-sm">
                    {isGoogleConnected && linkedGoogleEmail
                      ? `Connected with Google: ${linkedGoogleEmail}`
                      : isGoogleConnected
                        ? "Your account is connected with Google."
                        : "Connect your account with Google for easier sign-in."}
                  </p>
                </div>
              </div>
              <Button
                variant={isGoogleConnected ? "outline" : "default"}
                onClick={handleGoogleConnect}
                disabled={isConnecting}
                className="w-full sm:w-auto"
                aria-label={
                  isGoogleConnected
                    ? "Disconnect Google Account"
                    : "Connect Google Account"
                }
              >
                {isConnecting
                  ? isGoogleConnected
                    ? "Disconnecting..."
                    : "Connecting..."
                  : isGoogleConnected
                    ? "Disconnect"
                    : "Connect"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-xs">
          <CardHeader>
            <CardTitle className="text-xl">Two-Factor Authentication</CardTitle>
            <CardDescription>
              Use an authenticator app for a second sign-in step on your account.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-xl bg-primary/10 p-2 text-primary">
                  <KeyRound className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold">Authenticator App</h4>
                    <Badge variant={mfaEnabled ? "default" : "outline"}>
                      {mfaEnabled ? "Enabled" : "Not Enabled"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground sm:text-sm">
                    {mfaEnabled
                      ? `${mfaFactors.length} verified authenticator ${mfaFactors.length === 1 ? "app is" : "apps are"} protecting your account.`
                      : "Scan a QR code in Google Authenticator, 1Password, Authy, or a similar app to add a second login step."}
                  </p>
                </div>
              </div>

              {!pendingEnrollment && (
                <div className="flex flex-col gap-2 sm:items-end">
                  <Input
                    value={enrollmentFriendlyName}
                    onChange={(event) =>
                      setEnrollmentFriendlyName(event.target.value)
                    }
                    maxLength={64}
                    placeholder="Authenticator label"
                    className="w-full sm:w-56"
                    aria-label="Authenticator label"
                  />
                  <Button
                    onClick={handleStartEnrollment}
                    disabled={isStartingEnrollment || !mounted}
                    className="w-full sm:w-auto"
                  >
                    {isStartingEnrollment
                      ? "Preparing..."
                      : mfaEnabled
                        ? "Add another app"
                        : "Set up authenticator"}
                  </Button>
                </div>
              )}
            </div>

            {isMfaLoading ? (
              <div className="flex items-center justify-center py-10">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
              </div>
            ) : (
              <>
                {requiresStepUpVerification && mfaEnabled && (
                  <Alert>
                    <ShieldAlert className="h-4 w-4" />
                    <AlertTitle>Verify this session before changing MFA</AlertTitle>
                    <AlertDescription>
                      This session still needs a recent two-factor check before you can remove an authenticator. Use the button below to confirm your code and come right back here.
                    </AlertDescription>
                    <div className="pt-3">
                      <Button
                        variant="outline"
                        onClick={() =>
                          router.push(buildMfaRedirectPath("/account/authentication"))
                        }
                      >
                        Verify now
                      </Button>
                    </div>
                  </Alert>
                )}


                {pendingEnrollment && (
                  <div className="grid gap-4 rounded-xl border p-4 lg:grid-cols-[220px_1fr]">
                    <div className="flex flex-col items-center gap-3 rounded-xl bg-muted/30 p-4 text-center">
                      <div className="rounded-2xl border border-border/70 bg-white p-3 shadow-xs">
                        <QRCode
                          value={pendingEnrollment.uri}
                          size={170}
                          qrStyle="dots"
                          eyeRadius={8}
                          fgColor="#000000"
                          bgColor="#FFFFFF"
                          quietZone={8}
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-semibold">
                          {pendingEnrollment.friendlyName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Scan this QR code with your authenticator app.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <Alert>
                        <ShieldCheck className="h-4 w-4" />
                        <AlertTitle>Finish setup with one verification code</AlertTitle>
                        <AlertDescription>
                          After you confirm the code, this factor becomes active immediately and your other sessions may be signed out for safety.
                        </AlertDescription>
                      </Alert>

                      <div className="rounded-lg border bg-muted/30 p-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm font-medium">Manual setup key</p>
                            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                              {pendingEnrollment.secret}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={handleCopySetupKey}
                          >
                            <Copy className="mr-2 h-4 w-4" />
                            Copy key
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <p className="text-sm font-medium">
                          Enter the 6-digit code from your app
                        </p>
                        <InputOTP
                          value={enrollmentCode}
                          onChange={setEnrollmentCode}
                          maxLength={6}
                          pattern={REGEXP_ONLY_DIGITS}
                          containerClassName="justify-start"
                        >
                          <InputOTPGroup>
                            <InputOTPSlot index={0} />
                            <InputOTPSlot index={1} />
                            <InputOTPSlot index={2} />
                          </InputOTPGroup>
                          <InputOTPSeparator />
                          <InputOTPGroup>
                            <InputOTPSlot index={3} />
                            <InputOTPSlot index={4} />
                            <InputOTPSlot index={5} />
                          </InputOTPGroup>
                        </InputOTP>
                      </div>

                      <div className="flex flex-col gap-3 sm:flex-row">
                        <Button
                          onClick={handleVerifyEnrollment}
                          disabled={
                            isVerifyingEnrollment ||
                            isCancellingEnrollment ||
                            enrollmentCode.length !== 6
                          }
                          className="sm:w-auto"
                        >
                          {isVerifyingEnrollment
                            ? "Verifying..."
                            : "Verify and enable"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={handleCancelEnrollment}
                          disabled={isVerifyingEnrollment || isCancellingEnrollment}
                          className="sm:w-auto"
                        >
                          {isCancellingEnrollment
                            ? "Canceling..."
                            : "Cancel setup"}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {mfaEnabled && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Smartphone className="h-4 w-4 text-muted-foreground" />
                      Registered authenticators
                    </div>

                    {mfaFactors.map((factor, index) => {
                      const addedLabel = formatFactorMetadata(
                        factor.created_at,
                        "Added",
                      );
                      const lastUsedLabel = formatFactorMetadata(
                        factor.last_challenged_at,
                        "Last used",
                      );

                      return (
                        <div
                          key={factor.id}
                          className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold">
                                {getMfaFactorLabel(factor, index)}
                              </p>
                              <Badge variant="outline">Verified</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {[addedLabel, lastUsedLabel]
                                .filter(Boolean)
                                .join(" • ") ||
                                "This authenticator is ready for future sign-ins."}
                            </p>
                          </div>

                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setFactorToDisable(factor)}
                            disabled={isDisablingFactor}
                            className="w-full text-destructive hover:text-destructive sm:w-auto"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Remove
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog
        open={factorToDisable !== null}
        onOpenChange={(open) => {
          if (!open && !isDisablingFactor) {
            setFactorToDisable(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive">
              <Trash2 className="size-5" />
            </AlertDialogMedia>
            <AlertDialogTitle>Remove this authenticator?</AlertDialogTitle>
            <AlertDialogDescription>
              {factorToDisable
                ? `You’ll stop receiving codes from ${getMfaFactorLabel(factorToDisable)} on future sign-ins.`
                : "You’ll stop receiving codes from this authenticator on future sign-ins."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDisablingFactor}>
              Keep it
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(event) => {
                event.preventDefault();
                void handleDisableFactor();
              }}
              disabled={isDisablingFactor}
            >
              {isDisablingFactor ? "Removing..." : "Remove authenticator"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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