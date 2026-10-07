"use client";

import Link from "next/link";

import { SettingsSection } from "@/components/layout/SettingsSection";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";

import { AnonymousLinkingDialog } from "../AnonymousLinkingDialog";

export type LinkStatus = "unlinked" | "linked" | "verification-pending";

/**
 * Moving this profile into a Let's Assist account: the explanation, where
 * linking stands, and the one action that starts it.
 */
export function LinkAccountSection({
  id,
  accessToken,
  name,
  email,
  linkStatus,
  isLinked,
  autoLinkError,
  verificationPendingEmail,
  onLinked,
  onLinkedPendingVerification,
}: {
  id: string;
  accessToken: string;
  name: string;
  email: string;
  linkStatus: LinkStatus;
  isLinked: boolean;
  autoLinkError: string | null;
  verificationPendingEmail: string | null;
  onLinked: () => void;
  onLinkedPendingVerification: (email: string) => void;
}) {
  const pendingEmail = verificationPendingEmail ?? email;

  return (
    <SettingsSection
      title="Manage your profile"
      description={
        <>
          <span className="text-foreground font-medium">About linking:</span>{" "}
          When you link this anonymous profile to a Let&apos;s Assist account,
          all your event signups will be transferred to your account. Your
          signups are currently{" "}
          <span className="text-foreground font-medium">pending approval</span>{" "}
          from the project coordinator. Once approved, you can check in during
          events and track your volunteer hours—all in one place.
        </>
      }
    >
      {autoLinkError && !isLinked && (
        <Alert variant="warning">
          <AlertTitle>Linking needs one more step</AlertTitle>
          <AlertDescription>{autoLinkError}</AlertDescription>
        </Alert>
      )}

      {linkStatus === "linked" ? (
        <Alert variant="success">
          <AlertTitle>
            Account linked successfully! Your signups have been transferred.
          </AlertTitle>
        </Alert>
      ) : linkStatus === "verification-pending" ? (
        <Alert variant="info">
          <AlertTitle>Verify your new account</AlertTitle>
          <AlertDescription className="grid gap-3 [&_p:not(:last-child)]:mb-0">
            <p>
              Your volunteer profile is linked. We sent a verification email to{" "}
              <span className="text-foreground font-medium wrap-break-word">
                {pendingEmail}
              </span>
              .
            </p>
            <p>
              After verifying, sign in to access your volunteer dashboard,
              approvals, hours, and certificates.
            </p>
            <Link
              href={`/signup/success?email=${encodeURIComponent(pendingEmail)}`}
              className={buttonVariants({
                variant: "outline",
                className: "justify-self-start no-underline!",
              })}
            >
              Manage verification email
            </Link>
          </AlertDescription>
        </Alert>
      ) : (
        <AnonymousLinkingDialog
          anonymousId={id}
          anonymousToken={accessToken}
          defaultName={name}
          defaultEmail={email}
          isLinked={isLinked}
          onLinked={onLinked}
          onLinkedPendingVerification={onLinkedPendingVerification}
        />
      )}
    </SettingsSection>
  );
}
