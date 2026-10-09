"use client";

import { Fragment } from "react";
import { ShieldAlert, Trash2 } from "lucide-react";
import { SettingsSection } from "@/components/layout/SettingsSection";
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
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { getMfaFactorLabel } from "@/lib/auth/mfa";
import { TwoFactorEnrollment } from "./TwoFactorEnrollment";
import { useTwoFactor } from "./use-two-factor";

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

/**
 * Authenticator-app sign-in. The body shows one state at a time: loading,
 * session needs re-verification, setup in progress, enrolled, or not enrolled.
 */
export function TwoFactorSection() {
  const mfa = useTwoFactor();
  const {
    mfaEnabled,
    mfaFactors,
    pendingEnrollment,
    isMfaLoading,
    isDisablingFactor,
    factorToDisable,
  } = mfa;

  const needsSessionCheck = mfa.requiresStepUpVerification && mfaEnabled;
  const view = isMfaLoading
    ? "loading"
    : pendingEnrollment
      ? "enrolling"
      : needsSessionCheck
        ? "verify-session"
        : mfaEnabled
          ? "enrolled"
          : "not-enrolled";

  const labelInput = (
    <Input
      value={mfa.enrollmentFriendlyName}
      onChange={(event) => mfa.setEnrollmentFriendlyName(event.target.value)}
      maxLength={64}
      placeholder="Authenticator label"
      className="w-full sm:w-56"
      aria-label="Authenticator label"
    />
  );

  let footer: React.ReactNode = null;
  let footerHint: React.ReactNode = null;

  if (view === "enrolling") {
    footerHint = "Your other sessions may be signed out for safety.";
    footer = (
      <>
        <Button
          type="button"
          variant="ghost"
          onClick={mfa.handleCancelEnrollment}
          disabled={mfa.isVerifyingEnrollment || mfa.isCancellingEnrollment}
        >
          {mfa.isCancellingEnrollment ? "Canceling..." : "Cancel setup"}
        </Button>
        <Button
          onClick={mfa.handleVerifyEnrollment}
          disabled={
            mfa.isVerifyingEnrollment ||
            mfa.isCancellingEnrollment ||
            mfa.enrollmentCode.length !== 6
          }
        >
          {mfa.isVerifyingEnrollment ? "Verifying..." : "Verify and enable"}
        </Button>
      </>
    );
  } else if (view === "enrolled" || view === "not-enrolled") {
    footerHint = "Name the app so you can tell your authenticators apart.";
    footer = (
      <>
        {labelInput}
        <Button
          variant={mfaEnabled ? "outline" : "default"}
          onClick={mfa.handleStartEnrollment}
          disabled={mfa.isStartingEnrollment || !mfa.mounted}
        >
          {mfa.isStartingEnrollment
            ? "Preparing..."
            : mfaEnabled
              ? "Add another app"
              : "Set up authenticator"}
        </Button>
      </>
    );
  }

  return (
    <>
      <SettingsSection
        title="Two-factor authentication"
        description="Use an authenticator app for a second sign-in step on your account."
        status={
          isMfaLoading ? null : (
            <Badge variant={mfaEnabled ? "success" : "neutral"}>
              {mfaEnabled ? "Enabled" : "Not enabled"}
            </Badge>
          )
        }
        footer={footer}
        footerHint={footerHint}
      >
        {view === "loading" && (
          <div className="grid gap-2" aria-busy="true">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )}

        {view === "verify-session" && (
          <Alert variant="warning">
            <ShieldAlert />
            <AlertTitle>
              Verify this session before changing two-factor settings
            </AlertTitle>
            <AlertDescription>
              This session needs a recent two-factor check before you can add or
              remove an authenticator. Confirm your code and you will come right
              back here.
            </AlertDescription>
            <div className="col-start-2 pt-2">
              <Button variant="outline" onClick={mfa.handleVerifySession}>
                Verify session
              </Button>
            </div>
          </Alert>
        )}

        {view === "enrolling" && pendingEnrollment && (
          <TwoFactorEnrollment
            enrollment={pendingEnrollment}
            code={mfa.enrollmentCode}
            onCodeChange={mfa.setEnrollmentCode}
            onCopySetupKey={mfa.handleCopySetupKey}
          />
        )}

        {view === "not-enrolled" && (
          <p className="text-muted-foreground text-sm">
            Scan a QR code in Google Authenticator, 1Password, Authy, or a
            similar app. You will then enter a 6-digit code from the app each
            time you sign in.
          </p>
        )}

        {view === "enrolled" && (
          <ItemGroup className="gap-0">
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
                <Fragment key={factor.id}>
                  {index > 0 && <ItemSeparator className="my-0" />}
                  <Item className="px-0">
                    <ItemContent className="min-w-0">
                      <ItemTitle>
                        {getMfaFactorLabel(factor, index)}
                        <Badge variant="outline">Verified</Badge>
                      </ItemTitle>
                      <ItemDescription>
                        {[addedLabel, lastUsedLabel]
                          .filter(Boolean)
                          .join(" • ") ||
                          "This authenticator is ready for future sign-ins."}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => mfa.setFactorToDisable(factor)}
                        disabled={isDisablingFactor}
                      >
                        Remove
                      </Button>
                    </ItemActions>
                  </Item>
                </Fragment>
              );
            })}
          </ItemGroup>
        )}
      </SettingsSection>

      <AlertDialog
        open={factorToDisable !== null}
        onOpenChange={(open) => {
          if (!open && !isDisablingFactor) {
            mfa.setFactorToDisable(null);
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
                void mfa.handleDisableFactor();
              }}
              disabled={isDisablingFactor}
            >
              {isDisablingFactor ? "Removing..." : "Remove authenticator"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
