"use client";
import { safeConsole } from "@/lib/safe-console";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { MoreHorizontal, ShieldCheck, Trash } from "lucide-react";
import { toast } from "sonner";
import { SettingsSection } from "@/components/layout/SettingsSection";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { resolveAddEmailOutcome } from "./email-add-outcome";
import {
  addEmail,
  getLinkedIdentities,
  setPrimaryEmail,
  unlinkEmail,
  verifyEmail,
} from "@/utils/auth/account-management";

interface UserEmail {
  id: string;
  email: string;
  is_primary: boolean;
  verified_at: string | null;
}

/** Linked email addresses: list, set primary, remove, add and verify. */
export function EmailAddressesSection({
  user,
}: {
  user: { id: string } | null;
}) {
  const [emails, setEmails] = useState<UserEmail[]>([]);
  const [emailLoading, setEmailLoading] = useState(true);
  const [pendingPrimaryEmail, setPendingPrimaryEmail] = useState<string | null>(
    null,
  );
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [verificationStep, setVerificationStep] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [deliveryNotice, setDeliveryNotice] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [emailToRemove, setEmailToRemove] = useState<UserEmail | null>(null);

  const fetchEmails = useCallback(async () => {
    if (!user) {
      setEmails([]);
      setPendingPrimaryEmail(null);
      setEmailLoading(false);
      return;
    }

    setEmailLoading(true);

    try {
      const data = await getLinkedIdentities();
      setEmails(data as UserEmail[]);
      setPendingPrimaryEmail(null);
    } catch (error) {
      safeConsole.error("Failed to fetch emails:", error);
      toast.error("Failed to load email addresses");
    } finally {
      setEmailLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  // Shared by the add form and the "Send a new code" action. Returns to the
  // caller without changing the step when the request definitely failed.
  const requestCode = async (email: string) => {
    try {
      const outcome = resolveAddEmailOutcome(await addEmail(email));
      if (outcome.step === "error") {
        if (outcome.tone === "warning") toast.warning(outcome.message);
        else toast.error(outcome.message);
        return;
      }

      setPendingEmail(email);
      setVerificationStep(true);
      if (outcome.delivery === "unconfirmed") {
        setDeliveryNotice(outcome.notice);
        toast.warning(outcome.notice);
      } else {
        setDeliveryNotice(null);
        toast.success("Verification code sent to " + email);
      }
    } catch (error: unknown) {
      const err = error as Error;
      safeConsole.error("Error adding email:", error);
      toast.error(err.message || "Failed to add email");
    }
  };

  const handleAddEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail) return;

    setAdding(true);
    try {
      await requestCode(newEmail);
    } finally {
      setAdding(false);
    }
  };

  const handleResendCode = async () => {
    if (!pendingEmail) return;
    setAdding(true);
    try {
      setVerificationCode("");
      await requestCode(pendingEmail);
    } finally {
      setAdding(false);
    }
  };

  const handleVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verificationCode) return;

    setVerifying(true);
    try {
      await verifyEmail(pendingEmail, verificationCode);
      toast.success("Email verified successfully");
      setVerificationStep(false);
      setNewEmail("");
      setVerificationCode("");
      setPendingEmail("");
      setDeliveryNotice(null);
      fetchEmails();
    } catch (error: unknown) {
      const err = error as Error;
      safeConsole.error("Error verifying email:", error);
      toast.error(err.message || "Invalid verification code");
    } finally {
      setVerifying(false);
    }
  };

  const handleRemoveEmail = async (id: string) => {
    try {
      await unlinkEmail(id);
      toast.success("Email removed successfully");
      fetchEmails();
    } catch (error: unknown) {
      const err = error as Error;
      safeConsole.error("Error removing email:", error);
      toast.error(err.message || "Failed to remove email");
    }
  };

  const handleSetPrimary = async (email: string, verified: boolean) => {
    if (!verified) {
      toast.error("Only verified emails can be set as primary.");
      return;
    }

    try {
      const result = await setPrimaryEmail(email);
      if (result.needsConfirmation) {
        setPendingPrimaryEmail(result.pendingEmail || email);
        toast.info(
          "Email change pending confirmation. Check your inbox to finish the update.",
        );
        return;
      }
      toast.success("Primary email updated");
      setPendingPrimaryEmail(null);
      setTimeout(fetchEmails, 500);
    } catch (error: unknown) {
      const err = error as Error;
      safeConsole.error("Error setting primary email:", error);
      toast.error(err.message || "Failed to update primary email");
    }
  };

  const cancelVerification = () => {
    setVerificationStep(false);
    setVerificationCode("");
    setPendingEmail("");
    setDeliveryNotice(null);
  };

  return (
    <SettingsSection
      title="Email addresses"
      description={
        <>
          Extra addresses for account recovery. To change the email you sign in
          with, go to{" "}
          <Link
            href="/account/security"
            className="text-foreground underline underline-offset-4"
          >
            Sign-in &amp; security
          </Link>
          .
        </>
      }
    >
      {emailLoading ? (
        <div className="grid gap-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : emails.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No email addresses linked yet.
        </p>
      ) : (
        <ItemGroup className="gap-0">
          {emails.map((email, index) => {
            const isVerified = Boolean(email.verified_at);
            return (
              <Fragment key={email.id}>
                {index > 0 && <ItemSeparator className="my-0" />}
                <Item className="flex-nowrap px-0 py-2">
                  <ItemContent className="min-w-0">
                    <ItemTitle className="block w-full truncate">
                      {email.email}
                    </ItemTitle>
                    {(email.is_primary ||
                      !isVerified ||
                      pendingPrimaryEmail === email.email) && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {email.is_primary && (
                          <Badge variant="secondary">Primary</Badge>
                        )}
                        {!isVerified && (
                          <Badge variant="warning">Unverified</Badge>
                        )}
                        {pendingPrimaryEmail === email.email && (
                          <Badge variant="outline">Pending confirmation</Badge>
                        )}
                      </div>
                    )}
                  </ItemContent>
                  <ItemActions>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Actions for ${email.email}`}
                          >
                            <MoreHorizontal />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem
                          onClick={() =>
                            handleSetPrimary(email.email, isVerified)
                          }
                          disabled={!isVerified || email.is_primary}
                        >
                          <ShieldCheck />
                          Set as primary
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setEmailToRemove(email)}
                          disabled={email.is_primary}
                        >
                          <Trash />
                          Remove email
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </ItemActions>
                </Item>
              </Fragment>
            );
          })}
        </ItemGroup>
      )}

      {!emailLoading && (
        <>
          <Separator />
          {!verificationStep ? (
            <form onSubmit={handleAddEmail}>
              <Field>
                <FieldLabel htmlFor="email">Add an email</FieldLabel>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    required
                    className="flex-1"
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={adding}
                    className="shrink-0"
                  >
                    {adding && <Spinner data-icon="inline-start" />}
                    Add email
                  </Button>
                </div>
                <FieldDescription>
                  We&apos;ll send a 6-digit code to confirm it&apos;s yours.
                </FieldDescription>
              </Field>
            </form>
          ) : (
            <form onSubmit={handleVerifyEmail}>
              <Field>
                <FieldLabel htmlFor="code">Enter the 6-digit code</FieldLabel>
                {deliveryNotice ? (
                  <FieldDescription role="status">
                    {deliveryNotice} The address is{" "}
                    <span className="text-foreground font-medium break-all">
                      {pendingEmail}
                    </span>
                    .
                  </FieldDescription>
                ) : (
                  <FieldDescription>
                    Sent to{" "}
                    <span className="text-foreground font-medium break-all">
                      {pendingEmail}
                    </span>
                    .
                  </FieldDescription>
                )}
                <InputOTP
                  id="code"
                  value={verificationCode}
                  onChange={setVerificationCode}
                  maxLength={6}
                  pattern={REGEXP_ONLY_DIGITS}
                  containerClassName="justify-start"
                  autoFocus
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
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    variant="secondary"
                    disabled={verifying || !verificationCode}
                  >
                    {verifying && <Spinner data-icon="inline-start" />}
                    Verify
                  </Button>
                  {deliveryNotice ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={adding}
                      onClick={handleResendCode}
                    >
                      {adding && <Spinner data-icon="inline-start" />}
                      Send a new code
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={cancelVerification}
                  >
                    Cancel
                  </Button>
                </div>
              </Field>
            </form>
          )}
        </>
      )}

      <AlertDialog
        open={emailToRemove !== null}
        onOpenChange={(open) => {
          if (!open) setEmailToRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this email?</AlertDialogTitle>
            <AlertDialogDescription>
              {emailToRemove?.email} will no longer be linked to your account.
              You can add it again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (emailToRemove) {
                  void handleRemoveEmail(emailToRemove.id);
                }
                setEmailToRemove(null);
              }}
            >
              Remove email
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}
