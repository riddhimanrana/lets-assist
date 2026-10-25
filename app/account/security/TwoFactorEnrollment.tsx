"use client";

import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Copy } from "lucide-react";
import { QRCode } from "react-qrcode-logo";
import { Button } from "@/components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import type { PendingTotpEnrollment } from "./use-two-factor";

function StepHeading({ step, children }: { step: number; children: string }) {
  return (
    <p className="flex items-center gap-2 text-sm font-medium">
      <span className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs tabular-nums">
        {step}
      </span>
      {children}
    </p>
  );
}

/** The two setup steps: scan the QR code (or copy the key), then enter a code. */
export function TwoFactorEnrollment({
  enrollment,
  code,
  onCodeChange,
  onCopySetupKey,
}: {
  enrollment: PendingTotpEnrollment;
  code: string;
  onCodeChange: (value: string) => void;
  onCopySetupKey: () => void;
}) {
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div className="grid content-start gap-3">
        <StepHeading step={1}>Scan this code with your app</StepHeading>
        {/* The QR code stays on white so it scans in dark mode. */}
        <div className="w-fit rounded-lg border bg-white p-2">
          <QRCode
            value={enrollment.uri}
            size={170}
            qrStyle="dots"
            eyeRadius={8}
            fgColor="#000000"
            bgColor="#FFFFFF"
            quietZone={8}
          />
        </div>
        <p className="text-muted-foreground text-sm">
          Setting up{" "}
          <span className="text-foreground font-medium">
            {enrollment.friendlyName}
          </span>
          . Can&apos;t scan? Enter this key in your app instead.
        </p>
        <p className="font-mono text-sm break-all">{enrollment.secret}</p>
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          onClick={onCopySetupKey}
        >
          <Copy data-icon="inline-start" />
          Copy key
        </Button>
      </div>

      <div className="grid content-start gap-3">
        <StepHeading step={2}>Enter the 6-digit code from your app</StepHeading>
        <InputOTP
          value={code}
          onChange={onCodeChange}
          maxLength={6}
          pattern={REGEXP_ONLY_DIGITS}
          containerClassName="justify-start"
          aria-label="6-digit code from your authenticator app"
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
        <p className="text-muted-foreground text-sm">
          The authenticator becomes active as soon as the code is confirmed.
        </p>
      </div>
    </div>
  );
}
