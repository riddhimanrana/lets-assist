"use client";

import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { FieldError } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { ProjectVisibility } from "@/types";

import { FormGroup, OptionCard } from "./form-parts";

// The option card draws the focus ring, so the radio inside it does not.
const RADIO_CLASS = "focus-visible:ring-0";

export function VisibilitySettings({
  visibility,
  isOrganization,
  canUsePublicVisibility,
  updateVisibilityAction,
  error,
}: {
  visibility: ProjectVisibility;
  isOrganization: boolean;
  canUsePublicVisibility: boolean;
  updateVisibilityAction: (visibility: ProjectVisibility) => void;
  error?: string;
}) {
  const isPublicVisibilityDisabled = !canUsePublicVisibility;

  return (
    <FormGroup
      title="Who can see this project?"
      description="Choose who can discover and view your project on the Let's Assist platform."
    >
      <RadioGroup
        value={visibility}
        onValueChange={(value) =>
          updateVisibilityAction(value as ProjectVisibility)
        }
      >
        {/* Public */}
        <OptionCard
          htmlFor="visibility-public"
          selected={visibility === "public"}
          disabled={isPublicVisibilityDisabled}
          invalid={!!error}
          control={
            <RadioGroupItem
              value="public"
              id="visibility-public"
              disabled={isPublicVisibilityDisabled}
              className={RADIO_CLASS}
            />
          }
          title="Public (everyone)"
          badge={
            isPublicVisibilityDisabled ? (
              <Badge variant="outline">Trusted members</Badge>
            ) : (
              <Badge variant="secondary">Recommended</Badge>
            )
          }
          description="Your project appears on the home feed and in search results. Anyone on the platform can find and sign up for it."
        />

        {/* Unlisted */}
        <OptionCard
          htmlFor="visibility-unlisted"
          selected={visibility === "unlisted"}
          invalid={!!error}
          control={
            <RadioGroupItem
              value="unlisted"
              id="visibility-unlisted"
              className={RADIO_CLASS}
            />
          }
          title="Unlisted (by link only)"
          badge={<Badge variant="outline">Private link</Badge>}
          description="Only people with the direct link can find your project. Share the link with volunteers via email or social media. Won't appear in search or feeds."
        />

        {/* Organization Only - only show for organization projects */}
        {isOrganization && (
          <OptionCard
            htmlFor="visibility-org-only"
            selected={visibility === "organization_only"}
            invalid={!!error}
            control={
              <RadioGroupItem
                value="organization_only"
                id="visibility-org-only"
                className={RADIO_CLASS}
              />
            }
            title="Organization members only"
            badge={<Badge variant="outline">Private</Badge>}
            description="Only your organization members can see and sign up for this project. Great for internal volunteer opportunities or member-exclusive events."
          />
        )}
      </RadioGroup>

      {error ? <FieldError>{error}</FieldError> : null}

      {isPublicVisibilityDisabled && (
        <Alert variant="warning">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription>
            Public visibility is available to Trusted Members only. You can
            still create this project as a{" "}
            <span className="font-medium">Regular Member</span>
            {isOrganization ? " inside your organization" : ""}.{" "}
            <a href="/trusted-member">Apply here</a> to enable Public feed
            posting.
          </AlertDescription>
        </Alert>
      )}
    </FormGroup>
  );
}
