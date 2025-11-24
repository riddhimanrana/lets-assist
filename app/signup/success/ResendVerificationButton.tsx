'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Mail, Shield } from 'lucide-react';
import { resendVerificationEmail } from '../actions';
import { toast } from 'sonner';
import { TurnstileComponent, TurnstileRef } from '@/components/ui/turnstile';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ResendVerificationButtonProps {
  email: string;
}

export function ResendVerificationButton({ email }: ResendVerificationButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [canResend, setCanResend] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [isCaptchaOpen, setIsCaptchaOpen] = useState(false);
  const turnstileRef = useRef<TurnstileRef>(null);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }

    setCanResend(true);
  }, [countdown]);

  const closeDialog = () => {
    setIsCaptchaOpen(false);
    turnstileRef.current?.reset();
    setTurnstileToken(null);
    setTurnstileReady(false);
  };

  const handleResend = async () => {
    if (!turnstileToken) {
      toast.error('Please complete the verification challenge before resending.');
      return;
    }

    setIsLoading(true);

    try {
      const result = await resendVerificationEmail(email, turnstileToken);

      if (result.success) {
        toast.success(result.message || 'Verification email sent!');
        setCountdown(60);
        setCanResend(false);
        closeDialog();
      } else {
        toast.error(result.error || 'Failed to resend email');
        return;
      }
    } catch (error) {
      toast.error('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
      turnstileRef.current?.reset();
      setTurnstileToken(null);
      setTurnstileReady(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => setIsCaptchaOpen(true)}
        disabled={!canResend || isLoading}
        variant="outline"
        className="w-full"
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Sending...
          </>
        ) : canResend ? (
          <>
            <Mail className="mr-2 h-4 w-4" />
            Resend Verification Email
          </>
        ) : (
          <>
            <Mail className="mr-2 h-4 w-4" />
            Resend in {countdown}s
          </>
        )}
      </Button>

      <Dialog open={isCaptchaOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-lg rounded-2xl border border-border/60 bg-background shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">Verify before resending</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Complete the verification challenge so we can safely send a fresh confirmation link.
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
                  toast.error('Verification failed. Please try again.');
                }}
                onExpire={() => setTurnstileToken(null)}
                className="h-full w-full"
              />
            </div>
          </div>
          <DialogFooter className="flex flex-col gap-2">
            <Button
              onClick={handleResend}
              disabled={!turnstileToken || isLoading}
              className="w-full"
            >
              {isLoading ? 'Sending…' : 'Verify & send'}
            </Button>
            <Button variant="ghost" onClick={closeDialog} className="w-full">
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
