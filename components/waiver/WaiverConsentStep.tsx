"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface WaiverConsentStepProps {
  onConsent: (consented: boolean) => void;
  consented: boolean;
  waiverTitle?: string;
  className?: string;
}

export function WaiverConsentStep({
  onConsent,
  consented,
  waiverTitle,
  className
}: WaiverConsentStepProps) {
  return (
    <div className={cn("bg-muted/30 p-4 rounded-lg border", className)}>
      <div className="flex items-start space-x-3">
        <Checkbox 
            id="waiver-consent"
            checked={consented}
            onCheckedChange={(checked) => onConsent(checked as boolean)}
            className="mt-1"
        />
        <div className="space-y-1">
            <Label 
                htmlFor="waiver-consent"
                className="text-base font-medium leading-relaxed cursor-pointer"
            >
                I have reviewed the {waiverTitle || "waiver"} document.
            </Label>
            <p className="text-sm text-muted-foreground leading-relaxed">
                By attempting to sign, I confirm that I have read the waiver document, understand its contents, and agree to its terms. I understand that my electronic signature has the same legal effect and validity as a written signature.
            </p>
        </div>
      </div>
    </div>
  );
}
