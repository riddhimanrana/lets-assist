"use client";

import Link from "next/link";

import { SettingsSection } from "@/components/layout/SettingsSection";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";

import { AnonymousLinkingDialog } from "../AnonymousLinkingDialog";
import { cn } from "@/lib/utils";
import { anonymousLinkLoginHref } from "./link-routes";

/**
 * Where linking stands. "verification-pending" means the profile IS linked
 * to an account that has not verified its email (the server reports a
 * linked_user_id). A new account that still needs verification before any
 * link is a separate notice, `accountCreatedEmail`, and keeps "unlinked".
 */
export type LinkStatus = "unlinked" | "linked" | "verification-pending";

export const LINK_ACCOUNT_DESCRIPTION =
  "Link this guest profile to a Let's Assist account to keep your signups, attendance, hours and certificates in one place.";

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
  accountCreatedEmail = null,
  onLinked,
  onLinkedPendingVerification,
  onAccountCreatedPendingVerification,
}: {
  id: string;
  accessToken: string;
  name: string;
  email: string;
  linkStatus: LinkStatus;
  isLinked: boolean;
  autoLinkError: string | null;
  verificationPendingEmail: string | null;
  /** A new account awaiting email verification; the profile is not linked. */
  accountCreatedEmail?: string | null;
  onLinked: () => void;
  /** Legacy: the profile is linked to an account that is not yet verified. */
  onLinkedPendingVerification: (email: string) => void;
  onAccountCreatedPendingVerification?: (email: string) => void;
}) {
  const pendingEmail = verificationPendingEmail ?? email;

  return (
    <SettingsSection
      title="Manage your profile"
      description={LINK_ACCOUNT_DESCRIPTION}
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
              className={cn(
                buttonVariants({
                  variant: "outline",
                  className: "justify-self-start no-underline!",
                }),
              )}
            >
              Manage verification email
            </Link>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {accountCreatedEmail ? (
            <Alert variant="info">
              <AlertTitle>Verify your email to finish linking</AlertTitle>
              <AlertDescription className="grid gap-3 [&_p:not(:last-child)]:mb-0">
                <p>
                  Your account for{" "}
                  <span className="text-foreground font-medium wrap-break-word">
                    {accountCreatedEmail}
                  </span>{" "}
                  was created. Your guest signups stay here, unchanged, until
                  you link them.
                </p>
                <p>
                  Verify your email, then sign in and return to this page to
                  link them.
                </p>
                <Link
                  href={anonymousLinkLoginHref(id, accessToken)}
                  className={cn(
                    buttonVariants({
                      variant: "outline",
                      className: "justify-self-start no-underline!",
                    }),
                  )}
                >
                  Sign in to finish linking
                </Link>
              </AlertDescription>
            </Alert>
          ) : null}
          <AnonymousLinkingDialog
            anonymousId={id}
            anonymousToken={accessToken}
            defaultName={name}
            defaultEmail={email}
            isLinked={isLinked}
            onLinked={onLinked}
            onLinkedPendingVerification={onLinkedPendingVerification}
            onAccountCreatedPendingVerification={
              onAccountCreatedPendingVerification
            }
          />
        </>
      )}
    </SettingsSection>
  );
}
