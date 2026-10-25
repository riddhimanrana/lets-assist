import type { ReactNode } from "react";
import { Check, PenTool } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useWaiverDefinitionLoad } from "@/components/waiver/waiver-signing/WaiverDefinitionLoadContext";

/**
 * Offers the name and email a signed-out volunteer used last time on this
 * device. It stays quiet: one line, two small actions, one preference.
 */
export function ProjectFormSavedInfo({
  email,
  lastUpdatedDisplay,
  autoApplyEnabled,
  usedSavedProfile,
  waiverRequired,
  onApply,
  onForget,
  onAutoApplyChange,
}: {
  email: string;
  lastUpdatedDisplay: string;
  autoApplyEnabled: boolean;
  usedSavedProfile: boolean;
  waiverRequired: boolean;
  onApply: () => void;
  onForget: () => void;
  onAutoApplyChange: (enabled: boolean) => void;
}) {
  return (
    <div className="bg-muted/50 grid gap-3 rounded-lg border p-3">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="grid min-w-0 gap-0.5">
          <p className="text-sm font-medium break-words">
            Use saved info for {email}
          </p>
          <p className="text-muted-foreground text-sm">
            Updated {lastUpdatedDisplay}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" onClick={onApply}>
            Use saved info
          </Button>
          <Button type="button" variant="ghost" onClick={onForget}>
            Forget
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t pt-3">
        <Label htmlFor="auto-apply" className="text-muted-foreground">
          Auto-apply for future signups
        </Label>
        <Switch
          id="auto-apply"
          checked={autoApplyEnabled}
          onCheckedChange={onAutoApplyChange}
        />
      </div>

      {usedSavedProfile && (
        <p className="text-success text-sm" role="status">
          Info applied successfully
        </p>
      )}

      {waiverRequired && !usedSavedProfile && (
        <p className="text-muted-foreground text-sm">
          If this email already has a waiver for this project, we&apos;ll reuse
          it automatically.
        </p>
      )}
    </div>
  );
}

/** The waiver step of the quick sign-up form: sign, or review a signature. */
export function ProjectFormWaiverField({
  hasSignature,
  hasLocallyCachedWaiver,
  onOpen,
  children,
}: {
  hasSignature: boolean;
  hasLocallyCachedWaiver: boolean;
  onOpen: () => void;
  children: ReactNode;
}) {
  // Signing waits for the project's waiver form. A failed load still opens the
  // dialog, which explains the problem and offers a retry.
  const waiverFormLoading = useWaiverDefinitionLoad().status === "loading";

  return (
    <Field>
      <FieldLabel>Waiver agreement</FieldLabel>
      <FieldDescription>
        A signature is required to participate in this event.
      </FieldDescription>

      {!hasSignature && hasLocallyCachedWaiver && (
        <Alert variant="info">
          <AlertDescription>
            We found a recent waiver on this device, but it isn&apos;t confirmed
            on the server for this profile yet. Please sign again to continue.
          </AlertDescription>
        </Alert>
      )}

      {!hasSignature ? (
        <Button
          type="button"
          onClick={onOpen}
          variant="outline"
          className="w-full sm:w-auto sm:self-start"
          disabled={waiverFormLoading}
        >
          <PenTool data-icon="inline-start" aria-hidden="true" />
          Sign waiver
        </Button>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
          <p className="text-success flex items-center gap-2 text-sm font-medium">
            <Check className="size-4" aria-hidden="true" />
            Signature captured
          </p>
          <Button type="button" variant="ghost" onClick={onOpen}>
            Review
          </Button>
        </div>
      )}

      {children}
    </Field>
  );
}
