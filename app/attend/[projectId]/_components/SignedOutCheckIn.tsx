"use client";

import { Search } from "lucide-react";

import { UserIcon, useAnimatedIcon } from "@/components/icons/animated";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

import type { LookupResult } from "./attendance-session";

/**
 * Check-in for someone who is not signed in: sign in first, attend
 * anonymously when the project allows it, or look up a signup by email.
 */
export function SignedOutCheckIn({
  projectAllowsAnonymous,
  onSignIn,
  showAnonInputSection,
  onShowAnonInputSection,
  anonCheckinEmail,
  onAnonCheckinEmailChange,
  anonProfileLink,
  onAnonProfileLinkChange,
  isAnonSubmitting,
  onAnonCheckin,
  lookupEmail,
  onLookupEmailChange,
  isLookingUp,
  onLookupEmail,
  lookupResult,
}: {
  projectAllowsAnonymous: boolean;
  onSignIn: () => void;
  showAnonInputSection: boolean;
  onShowAnonInputSection: () => void;
  anonCheckinEmail: string;
  onAnonCheckinEmailChange: (value: string) => void;
  anonProfileLink: string;
  onAnonProfileLinkChange: (value: string) => void;
  isAnonSubmitting: boolean;
  onAnonCheckin: () => void;
  lookupEmail: string;
  onLookupEmailChange: (value: string) => void;
  isLookingUp: boolean;
  onLookupEmail: () => void;
  lookupResult: LookupResult | null;
}) {
  const signInIcon = useAnimatedIcon();
  const anonymousFormOpen = projectAllowsAnonymous && showAnonInputSection;

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        {/* The filled action follows the path the volunteer picked. */}
        <Button
          size="lg"
          variant={anonymousFormOpen ? "outline" : "default"}
          className="h-12 w-full text-base"
          onClick={onSignIn}
          {...signInIcon.triggerProps}
        >
          <UserIcon
            ref={signInIcon.ref}
            size={16}
            data-icon="inline-start"
            aria-hidden="true"
          />
          Sign in with Let&apos;s Assist account
        </Button>
        {projectAllowsAnonymous && !showAnonInputSection ? (
          <Button
            size="lg"
            variant="outline"
            className="w-full"
            onClick={onShowAnonInputSection}
          >
            Attend anonymously
          </Button>
        ) : null}
      </div>

      {anonymousFormOpen ? (
        <form
          className="grid gap-4 border-t pt-6"
          onSubmit={(event) => {
            event.preventDefault();
            onAnonCheckin();
          }}
        >
          <h2 className="text-lg font-semibold tracking-tight">
            Attend anonymously
          </h2>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="anon-email">Email address</FieldLabel>
              <Input
                id="anon-email"
                type="email"
                autoComplete="email"
                value={anonCheckinEmail}
                onChange={(event) =>
                  onAnonCheckinEmailChange(event.target.value)
                }
                placeholder="Enter your signup email"
                aria-label="Email address for anonymous check-in"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="anon-profile-link">
                Private anonymous profile link
              </FieldLabel>
              <Input
                id="anon-profile-link"
                type="url"
                value={anonProfileLink}
                onChange={(event) =>
                  onAnonProfileLinkChange(event.target.value)
                }
                placeholder="Paste the link from your confirmation email"
                aria-label="Private anonymous profile link"
              />
              <FieldDescription>
                This verifies that the anonymous signup belongs to you. The link
                is never displayed to other attendees.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <Button
            type="submit"
            size="lg"
            className="h-12 w-full text-base"
            disabled={isAnonSubmitting || !anonCheckinEmail || !anonProfileLink}
          >
            {isAnonSubmitting ? (
              <>
                <Spinner data-icon="inline-start" aria-hidden="true" />
                Checking in...
              </>
            ) : (
              "Check in anonymously"
            )}
          </Button>
        </form>
      ) : null}

      <FieldSeparator>Not sure?</FieldSeparator>

      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onLookupEmail();
        }}
      >
        <Field>
          <FieldLabel htmlFor="email-lookup">
            Check your signup status
          </FieldLabel>
          <div className="flex gap-2">
            <Input
              id="email-lookup"
              type="email"
              autoComplete="email"
              placeholder="Enter your email"
              value={lookupEmail}
              onChange={(event) => onLookupEmailChange(event.target.value)}
              aria-label="Email address for signup status lookup"
            />
            <Button
              type="submit"
              variant="outline"
              size="icon"
              disabled={isLookingUp || !lookupEmail}
              aria-label="Lookup email status"
            >
              {isLookingUp ? (
                <Spinner aria-hidden="true" />
              ) : (
                <Search aria-hidden="true" />
              )}
            </Button>
          </div>
        </Field>
        <LookupResultAlert lookupResult={lookupResult} onSignIn={onSignIn} />
      </form>
    </div>
  );
}

function LookupResultAlert({
  lookupResult,
  onSignIn,
}: {
  lookupResult: LookupResult | null;
  onSignIn: () => void;
}) {
  if (!lookupResult) return null;

  if (!lookupResult.success) {
    return (
      <Alert variant="destructive">
        <AlertTitle>
          {lookupResult.error ||
            lookupResult.message ||
            "An error occurred during lookup."}
        </AlertTitle>
      </Alert>
    );
  }

  const isPendingAnonymous =
    !lookupResult.isRegistered &&
    lookupResult.found &&
    lookupResult.message.includes("pending");
  const variant = !lookupResult.found
    ? "default"
    : lookupResult.isRegistered
      ? "info"
      : lookupResult.message.includes("approved")
        ? "success"
        : lookupResult.message.includes("pending")
          ? "warning"
          : "default";

  return (
    <Alert variant={variant}>
      <AlertTitle className="wrap-break-word">
        {lookupResult.message}
      </AlertTitle>
      {/* Prompt to log in if a registered account was found */}
      {lookupResult.isRegistered ? (
        <AlertDescription>
          <Button
            type="button"
            variant="link"
            className="h-9 px-0"
            onClick={onSignIn}
          >
            Log in now to check in
          </Button>
        </AlertDescription>
      ) : null}
      {isPendingAnonymous ? (
        <AlertDescription>
          Your signup requires organizer approval before you can check in.
        </AlertDescription>
      ) : null}
    </Alert>
  );
}
