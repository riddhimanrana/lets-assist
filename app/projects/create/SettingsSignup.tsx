"use client";

import { AlertTriangle, Info } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FieldError } from "@/components/ui/field";

import { FormGroup, ToggleRow } from "./form-parts";

export function SignupSettings({
  isSignupOnly,
  requireLogin,
  enableVolunteerComments,
  showAttendeesPublicly,
  updateRequireLoginAction,
  updateEnableVolunteerCommentsAction,
  updateShowAttendeesPubliclyAction,
  error,
}: {
  isSignupOnly: boolean;
  requireLogin: boolean;
  enableVolunteerComments: boolean;
  showAttendeesPublicly: boolean;
  updateRequireLoginAction: (requireLogin: boolean) => void;
  updateEnableVolunteerCommentsAction: (enabled: boolean) => void;
  updateShowAttendeesPubliclyAction: (enabled: boolean) => void;
  error?: string;
}) {
  return (
    <>
      <FormGroup
        title="Volunteer sign-up requirements"
        description="Control whether volunteers need to create an account to sign up for your event."
      >
        <ToggleRow
          id="require-login"
          label="Require account for sign-up"
          description={
            requireLogin
              ? "Volunteers must create an account to sign up for your event"
              : "Anyone can sign up without creating an account (anonymous volunteers)"
          }
          checked={isSignupOnly ? false : requireLogin}
          onCheckedChange={updateRequireLoginAction}
          disabled={isSignupOnly}
        />

        {isSignupOnly && (
          <Alert variant="info">
            <Info aria-hidden="true" />
            <AlertDescription>
              Signup-only projects collect names and contact information without
              account creation or email verification. Volunteers can still link
              the signup to an account later.
            </AlertDescription>
          </Alert>
        )}

        {error && !isSignupOnly ? <FieldError>{error}</FieldError> : null}

        {!requireLogin && !isSignupOnly && (
          <Alert variant="warning">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Anonymous sign-ups</AlertTitle>
            <AlertDescription>
              With anonymous sign-ups enabled, volunteers won&apos;t need to
              create accounts. This may increase participation but makes
              tracking and verification more challenging.
            </AlertDescription>
          </Alert>
        )}
      </FormGroup>

      <FormGroup
        title="Volunteer options"
        description="Optional settings that control what volunteers can submit and what is visible publicly."
      >
        <ToggleRow
          id="enable-comments"
          label="Enable volunteer comments"
          description="Allow volunteers to include a short note when signing up."
          checked={enableVolunteerComments}
          onCheckedChange={updateEnableVolunteerCommentsAction}
        />
        <ToggleRow
          id="show-attendees-public"
          label="Show attendees publicly"
          description="Display attendee names on the project page."
          checked={showAttendeesPublicly}
          onCheckedChange={updateShowAttendeesPubliclyAction}
        />
      </FormGroup>
    </>
  );
}

export function DomainSettings({
  restrictToOrgDomains,
  allowedEmailDomains,
  updateRestrictToOrgDomainsAction,
}: {
  restrictToOrgDomains: boolean;
  allowedEmailDomains: string[];
  updateRestrictToOrgDomainsAction: (restrict: boolean) => void;
}) {
  return (
    <FormGroup
      title="Email domain requirements"
      description="Optionally require volunteers to have an email from your organization's approved domains to sign up."
    >
      <ToggleRow
        id="restrict-domains"
        label="Require organization email"
        description={
          restrictToOrgDomains
            ? `Only emails from: ${allowedEmailDomains.join(", ")} can sign up`
            : `Optional: Allow emails from any domain to sign up`
        }
        checked={restrictToOrgDomains}
        onCheckedChange={updateRestrictToOrgDomainsAction}
      />
    </FormGroup>
  );
}
