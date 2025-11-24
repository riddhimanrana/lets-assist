"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertCircle, Mail, RotateCcw, Shield } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { resendVerificationEmail } from "@/app/signup/actions";
import { toast } from "sonner";
import { TurnstileComponent, TurnstileRef } from "@/components/ui/turnstile";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface EmailExpiredClientProps {
  email: string;
}

export default function EmailExpiredClient({
  email,
}: EmailExpiredClientProps) {
  const [isResending, setIsResending] = useState(false);
  const [hasResent, setHasResent] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [isCaptchaOpen, setIsCaptchaOpen] = useState(false);
  const turnstileRef = useRef<TurnstileRef>(null);

  const closeDialog = () => {
    setIsCaptchaOpen(false);
    turnstileRef.current?.reset();
    setTurnstileToken(null);
    setTurnstileReady(false);
  };

  const handleResendEmail = async () => {
    if (!email) {
      toast.error("Email address not found. Please sign up again.");
      return;
    }

    if (!turnstileToken) {
      toast.error("Please complete the verification challenge before resending.");
      return;
    }

    setIsResending(true);
    try {
      const result = await resendVerificationEmail(email, turnstileToken);

      if (result.success) {
        setHasResent(true);
        toast.success(result.message || "Verification email resent!");
        closeDialog();
      } else {
        if ("code" in result) {
          if (result.code === "link_expired") {
            toast.error(
              "The verification link has expired. Please sign up again with this email.",
            );
          } else if (result.code === "captcha_required") {
            toast.error(
              "Too many resend attempts. Please try again later or sign up with a new email.",
            );
          } else {
            toast.error(result.error || "Failed to resend email");
          }
        } else {
          toast.error(result.error || "Failed to resend email");
        }
      }
    } catch (error) {
      toast.error("An unexpected error occurred. Please try again.");
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <Card className="w-full max-w-md mx-auto">
        <CardHeader className="space-y-4">
          <div className="flex justify-center">
            <AlertCircle className="h-12 w-12 text-amber-600" />
          </div>
          <CardTitle className="text-2xl text-center">
            Verification Link Expired
          </CardTitle>
          <CardDescription className="text-center">
            Your email verification link has expired. The confirmation token is
            valid for only 15 minutes (900 seconds), so please request a new link
            if it times out.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert
            className="border"
            style={{
              backgroundColor: "var(--secondary)",
              borderColor: "var(--border)",
              color: "var(--muted-foreground)",
            }}
          >
            <AlertCircle
              className="h-4 w-4"
              style={{ color: "var(--muted-foreground)" }}
            />
            <AlertDescription>
              {email
                ? `We can resend a new verification link to ${email}`
                : "We can send you a new verification link."}
            </AlertDescription>
          </Alert>

          <div className="space-y-3">
            {hasResent ? (
              <div
                className="flex items-center gap-2 p-3 rounded-md border"
                style={{
                  backgroundColor: "var(--primary)",
                  borderColor: "var(--border)",
                  color: "var(--primary-foreground)",
                }}
              >
                <Mail className="h-5 w-5" style={{ color: "var(--primary-foreground)" }} />
                <p className="text-sm">
                  Email resent! Check your inbox and junk folder.
                </p>
              </div>
            ) : null}

            <p className="text-sm text-center text-muted-foreground">
              Complete a quick verification step before we resend another link.
            </p>

            <Button
              onClick={() => setIsCaptchaOpen(true)}
              disabled={isResending || hasResent}
              className="w-full"
              size="lg"
            >
              {isResending ? (
                <>
                  <RotateCcw className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : hasResent ? (
                <>
                  <Mail className="mr-2 h-4 w-4" />
                  Verification Email Resent
                </>
              ) : (
                <>
                  <Mail className="mr-2 h-4 w-4" />
                  Resend Verification Email
                </>
              )}
            </Button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">
                Or try another option
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <Link href="/login" className="block">
              <Button variant="outline" className="w-full">
                Go to Login
              </Button>
            </Link>
            <Link href="/signup" className="block">
              <Button variant="ghost" className="w-full">
                Create New Account
              </Button>
            </Link>
          </div>

          <p className="text-xs text-center text-muted-foreground">
            Having trouble? <Link href="/help" className="text-primary underline">
              Contact Support
            </Link>
          </p>
        </CardContent>
      </Card>

      <Dialog open={isCaptchaOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-lg rounded-2xl border border-border/60 bg-background shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">Verify before resending</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Complete the verification challenge so we can safely send a new link to your inbox.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center py-4">
            <div className="relative w-[300px] h-[65px] overflow-hidden rounded-lg bg-muted/30 border border-border/50 flex items-center justify-center">
              {!turnstileReady && (
                <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-lg bg-background/80 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Shield className="h-4 w-4 text-muted-foreground/80" />
                  <span className="text-[0.7rem] font-semibold normal-case tracking-wide">
                    Bot verification loading…
                  </span>
                </div>
              )}
              <TurnstileComponent
                ref={turnstileRef}
                onLoad={() => setTurnstileReady(true)}
                onVerify={(token) => setTurnstileToken(token)}
                onError={() => {
                  setTurnstileToken(null);
                  toast.error("Verification failed. Please try again.");
                }}
                onExpire={() => setTurnstileToken(null)}
                className="h-full w-full"
              />
            </div>
          </div>
          <DialogFooter className="flex flex-col gap-2">
            <Button
              onClick={handleResendEmail}
              disabled={!turnstileToken || isResending}
              className="w-full"
            >
              {isResending ? 'Sending…' : 'Verify & send'}
            </Button>
            <Button variant="ghost" onClick={closeDialog} className="w-full">
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
