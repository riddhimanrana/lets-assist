"use client";

import { REGEXP_ONLY_DIGITS } from "input-otp";
import {
  AlertTriangle,
  LogOut,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import {
  deriveAuthenticatorAssurance,
  getMfaFactorLabel,
  getVerifiedTotpFactors,
  shouldPromptForMfaChallenge,
  type MfaFactorLike,
  type MfaListFactorsLike,
} from "@/lib/auth/mfa";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type MfaChallengeClientProps = {
  redirectPath: string;
  email: string | null;
};

function getMfaVerificationErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "We couldn't verify that code. Please try again.";
  }

  const normalizedMessage = error.message.toLowerCase();

  if (
    normalizedMessage.includes("invalid totp") ||
    normalizedMessage.includes("invalid otp") ||
    normalizedMessage.includes("invalid code") ||
    normalizedMessage.includes("expired")
  ) {
    return "That code is invalid or expired. Enter the latest 6-digit code and try again.";
  }

  return error.message || "We couldn't verify that code. Please try again.";
}

export default function MfaChallengeClient({
  redirectPath,
  email,
}: MfaChallengeClientProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [isLoading, setIsLoading] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [factors, setFactors] = useState<MfaFactorLike[]>([]);
  const [selectedFactorId, setSelectedFactorId] = useState<string | null>(null);

  const loadChallengeState = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const [
        { data: claimsData, error: claimsError },
        { data: factorsData, error: factorsError },
      ] = await Promise.all([
        supabase.auth.getClaims(),
        supabase.auth.mfa.listFactors(),
      ]);

      if (factorsError) {
        throw factorsError;
      }

      if (claimsError) {
        console.error("Failed to load auth claims for MFA challenge:", claimsError);
      }

      const factorData = factorsData as MfaListFactorsLike | null;
      const assuranceData = deriveAuthenticatorAssurance(
        typeof claimsData?.claims?.aal === "string" ? claimsData.claims.aal : null,
        factorData,
      );
      const verifiedFactors = getVerifiedTotpFactors(factorData);

      if (!shouldPromptForMfaChallenge(assuranceData, factorData)) {
        router.replace(redirectPath);
        router.refresh();
        return;
      }

      if (verifiedFactors.length === 0) {
        setErrorMessage(
          "We couldn't find a verified authenticator app on this account. Sign out and try another login method, or contact support if this keeps happening.",
        );
        setFactors([]);
        setSelectedFactorId(null);
        return;
      }

      setFactors(verifiedFactors);
      setSelectedFactorId((currentSelectedFactorId) => {
        if (
          currentSelectedFactorId &&
          verifiedFactors.some((factor) => factor.id === currentSelectedFactorId)
        ) {
          return currentSelectedFactorId;
        }

        return verifiedFactors[0]?.id ?? null;
      });
    } catch (error) {
      console.error("Failed to load MFA challenge state:", error);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "We couldn't load your authenticator options right now.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [redirectPath, router, supabase]);

  useEffect(() => {
    void loadChallengeState();
  }, [loadChallengeState]);

  const handleVerify = async () => {
    const normalizedCode = verificationCode.replace(/\s+/g, "").trim();

    if (!selectedFactorId) {
      setErrorMessage("Select an authenticator app before continuing.");
      return;
    }

    if (normalizedCode.length !== 6) {
      setErrorMessage("Enter the 6-digit code from your authenticator app.");
      return;
    }

    setIsVerifying(true);
    setErrorMessage(null);

    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: selectedFactorId,
        code: normalizedCode,
      });

      if (error) {
        throw error;
      }

      toast.success("Verification complete.");
      router.replace(redirectPath);
      router.refresh();
    } catch (error) {
      console.error("Failed to verify MFA challenge:", error);
      const message = getMfaVerificationErrorMessage(error);

      setErrorMessage(message);
      toast.error(message);
      setIsVerifying(false);
      return;
    }

    setIsVerifying(false);
  };

  const handleUseAnotherAccount = async () => {
    try {
      const { error } = await supabase.auth.signOut();

      if (error) {
        throw error;
      }

      const loginUrl =
        redirectPath === "/home"
          ? "/login"
          : `/login?redirect=${encodeURIComponent(redirectPath)}`;

      router.replace(loginUrl);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "We couldn't sign you out right now.",
      );
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4 sm:p-6">
      <Card className="w-full max-w-xl border shadow-xs">
        <CardHeader className="space-y-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-2xl">Verify it’s really you</CardTitle>
            <CardDescription>
              {email
                ? `Enter the current code from your authenticator app to continue as ${email}.`
                : "Enter the current code from your authenticator app to continue."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
              <p className="text-sm text-muted-foreground">
                Checking your authenticator requirement…
              </p>
            </div>
          ) : (
            <>
              {errorMessage && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Verification issue</AlertTitle>
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              )}

              {factors.length > 0 && (
                <div className="space-y-4">
                  {factors.length > 1 ? (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Choose an authenticator</p>
                      <div className="grid gap-2">
                        {factors.map((factor, index) => {
                          const isSelected = factor.id === selectedFactorId;

                          return (
                            <button
                              key={factor.id}
                              type="button"
                              onClick={() => setSelectedFactorId(factor.id)}
                              className={cn(
                                "flex items-center justify-between rounded-lg border px-3 py-3 text-left transition-colors hover:bg-muted/40",
                                isSelected &&
                                  "border-primary bg-primary/5 text-primary",
                              )}
                            >
                              <div className="flex items-center gap-3">
                                <div className="rounded-lg bg-muted p-2 text-muted-foreground">
                                  <Smartphone className="h-4 w-4" />
                                </div>
                                <div>
                                  <p className="text-sm font-semibold text-foreground">
                                    {getMfaFactorLabel(factor, index)}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    Enter the latest 6-digit code from this device.
                                  </p>
                                </div>
                              </div>
                              {isSelected && <Badge>Selected</Badge>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">Using</p>
                        <Badge variant="outline">
                          {getMfaFactorLabel(factors[0], 0)}
                        </Badge>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <p className="text-sm font-medium">6-digit authenticator code</p>
                    <InputOTP
                      value={verificationCode}
                      onChange={setVerificationCode}
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
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  onClick={handleVerify}
                  disabled={
                    isVerifying || !selectedFactorId || verificationCode.length !== 6
                  }
                  className="sm:w-auto"
                >
                  {isVerifying ? "Verifying..." : "Verify and continue"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleUseAnotherAccount}
                  disabled={isVerifying}
                  className="sm:w-auto"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Use another account
                </Button>
              </div>

              {/* <Alert>
                <ShieldCheck className="h-4 w-4" />
                <AlertTitle>Trouble with your code?</AlertTitle>
                <AlertDescription>
                  Use the newest 6-digit authenticator code, switch to another
                  account, or contact support if you&apos;re locked out.
                </AlertDescription>
              </Alert> */}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}