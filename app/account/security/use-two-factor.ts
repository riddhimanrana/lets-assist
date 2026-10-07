"use client";
import { safeConsole } from "@/lib/safe-console";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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

/** Where the MFA challenge sends the user back to after a step-up check. */
export const SECURITY_PAGE_PATH = "/account/security";

export type PendingTotpEnrollment = {
  id: string;
  friendlyName: string;
  qrCode: string;
  secret: string;
  uri: string;
};

/**
 * The authenticator-app state machine: loading factors, enrolling, verifying,
 * cancelling and removing. Moved as is from the old Authentication page; only
 * the return path changed to this page.
 */
export function useTwoFactor() {
  const { user } = useAuth();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [mounted, setMounted] = useState(false);
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
        safeConsole.error(
          "Failed to load auth claims for MFA settings:",
          claimsError,
        );
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
        typeof claimsData?.claims?.aal === "string"
          ? claimsData.claims.aal
          : null,
        factorData,
      );

      setMfaFactors(getVerifiedTotpFactors(factorData));
      setAalState({
        currentLevel: assuranceData?.currentLevel ?? null,
        nextLevel: assuranceData?.nextLevel ?? null,
      });
    } catch (error) {
      safeConsole.error("Failed to load MFA settings:", error);
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

    if (!user) {
      setIsMfaLoading(false);
      setMfaFactors([]);
      setAalState(null);
      setPendingEnrollment(null);
      return;
    }

    void loadMfaState();
  }, [loadMfaState, mounted, user]);

  const refreshSessionAfterMfaChange = useCallback(async () => {
    const { error } = await supabase.auth.refreshSession();

    if (error) {
      safeConsole.warn("Session refresh after MFA update failed:", error);
    }
  }, [supabase]);

  const handleStartEnrollment = async () => {
    if (!user) {
      toast.error(
        "You need to be signed in to configure an authenticator app.",
      );
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
        throw (
          error ?? new Error("Supabase did not return an authenticator factor.")
        );
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
      safeConsole.error("Failed to enroll authenticator factor:", error);
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
      toast.error(
        "Couldn't copy the setup key. You can still copy it manually.",
      );
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
      safeConsole.error("Failed to verify authenticator factor:", error);
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
      safeConsole.error("Failed to cancel authenticator setup:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn't cancel authenticator setup right now.",
      );
    } finally {
      setIsCancellingEnrollment(false);
    }
  };

  const handleVerifySession = () => {
    router.push(buildMfaRedirectPath(SECURITY_PAGE_PATH));
  };

  const handleDisableFactor = async () => {
    if (!factorToDisable) {
      return;
    }

    if (aalState?.currentLevel !== "aal2") {
      toast.info(
        "Please verify your identity before removing an authenticator.",
      );
      router.push(buildMfaRedirectPath(SECURITY_PAGE_PATH));
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
      safeConsole.error("Failed to remove authenticator factor:", error);
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

  return {
    mounted,
    isMfaLoading,
    mfaFactors,
    mfaEnabled,
    requiresStepUpVerification,
    pendingEnrollment,
    enrollmentFriendlyName,
    setEnrollmentFriendlyName,
    enrollmentCode,
    setEnrollmentCode,
    isStartingEnrollment,
    isVerifyingEnrollment,
    isCancellingEnrollment,
    factorToDisable,
    setFactorToDisable,
    isDisablingFactor,
    handleStartEnrollment,
    handleCopySetupKey,
    handleVerifyEnrollment,
    handleCancelEnrollment,
    handleVerifySession,
    handleDisableFactor,
  };
}
