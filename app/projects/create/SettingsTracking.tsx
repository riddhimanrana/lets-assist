"use client";

import { Badge } from "@/components/ui/badge";
import { FieldError } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { VerificationMethod } from "@/types";

import { FormGroup, OptionCard } from "./form-parts";

// The option card draws the focus ring, so the radio inside it does not.
const RADIO_CLASS = "focus-visible:ring-0";

export function TrackingSettings({
  verificationMethod,
  updateVerificationMethodAction,
  updateRequireLoginAction,
  error,
}: {
  verificationMethod: VerificationMethod;
  updateVerificationMethodAction: (method: VerificationMethod) => void;
  updateRequireLoginAction: (requireLogin: boolean) => void;
  error?: string;
}) {
  const isSignupOnly = verificationMethod === "signup-only";
  const trackingMode = isSignupOnly ? "signup-only" : "track-hours";

  return (
    <>
      <FormGroup
        title="Volunteer tracking"
        description="Decide whether this project should record volunteer hours or only collect signups."
      >
        <RadioGroup
          value={trackingMode}
          onValueChange={(value) => {
            if (value === "signup-only") {
              updateVerificationMethodAction("signup-only");
              updateRequireLoginAction(false);
              return;
            }

            updateVerificationMethodAction(
              verificationMethod === "signup-only"
                ? "qr-code"
                : verificationMethod,
            );
          }}
        >
          <OptionCard
            htmlFor="track-hours"
            selected={trackingMode === "track-hours"}
            control={
              <RadioGroupItem
                value="track-hours"
                id="track-hours"
                className={RADIO_CLASS}
              />
            }
            title="Track volunteer hours"
            badge={<Badge variant="secondary">Recommended</Badge>}
            description="Use QR, manual, or automatic check-in. Volunteers use accounts so their hours, certificates, and dashboard stay connected."
          />
          <OptionCard
            htmlFor="signup-only-tracking"
            selected={trackingMode === "signup-only"}
            control={
              <RadioGroupItem
                value="signup-only"
                id="signup-only-tracking"
                className={RADIO_CLASS}
              />
            }
            title="Collect signups only"
            badge={<Badge variant="outline">No email verification</Badge>}
            description="Best for headcount, interest lists, and events where attendance is tracked somewhere else. Volunteers can sign up without creating or verifying an account."
          />
        </RadioGroup>
      </FormGroup>

      {!isSignupOnly && (
        <FormGroup
          title="Volunteer check-in method"
          description="Choose how volunteers will check in and record their hours at your event."
        >
          <RadioGroup
            value={verificationMethod}
            onValueChange={(value) =>
              updateVerificationMethodAction(value as VerificationMethod)
            }
          >
            <OptionCard
              htmlFor="qr-code"
              selected={verificationMethod === "qr-code"}
              invalid={!!error}
              control={
                <RadioGroupItem
                  value="qr-code"
                  id="qr-code"
                  className={RADIO_CLASS}
                />
              }
              title="QR code self check-in"
              badge={<Badge variant="secondary">Recommended</Badge>}
              description="Volunteers scan QR code and log in to track their own hours. They can leave anytime, with automatic logout at the scheduled end time. Hours can be adjusted if needed."
            />
            <OptionCard
              htmlFor="manual"
              selected={verificationMethod === "manual"}
              invalid={!!error}
              control={
                <RadioGroupItem
                  value="manual"
                  id="manual"
                  className={RADIO_CLASS}
                />
              }
              title="Manual check-in by organizer"
              description="You'll manually log each volunteer's attendance and hours. Most time-consuming for organizers but provides the highest level of verification."
            />
            <OptionCard
              htmlFor="auto"
              selected={verificationMethod === "auto"}
              invalid={!!error}
              control={
                <RadioGroupItem
                  value="auto"
                  id="auto"
                  className={RADIO_CLASS}
                />
              }
              title="Automatic check-in/out"
              badge={<Badge variant="warning">Not recommended</Badge>}
              description="System automatically logs attendance for the full scheduled time. Least accurate for attendance tracking."
            />
          </RadioGroup>

          {error ? <FieldError>{error}</FieldError> : null}
        </FormGroup>
      )}
    </>
  );
}
