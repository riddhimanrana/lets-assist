'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Mail } from 'lucide-react';
import { resendVerificationEmail } from '../actions';
import { toast } from 'sonner';
import { BotVerificationDialog } from '@/components/shared/BotVerificationDialog';

interface ResendVerificationButtonProps {
  email: string;
  redirectPath?: string | null;
}

export function ResendVerificationButton({ email, redirectPath }: ResendVerificationButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [canResend, setCanResend] = useState(false);
  const [isCaptchaOpen, setIsCaptchaOpen] = useState(false);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }

    setCanResend(true);
  }, [countdown]);

  const handleVerified = async (token: string) => {
    setIsLoading(true);

    try {
      const result = await resendVerificationEmail(email, token, redirectPath ?? null);

      if (result.success) {
        toast.success(result.message || 'Verification email sent!');
        setCountdown(60);
        setCanResend(false);
        setIsCaptchaOpen(false);
      } else {
        toast.error(result.error || 'Failed to resend email');
      }
    } catch {
      toast.error('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
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

      <BotVerificationDialog
        isOpen={isCaptchaOpen}
        onClose={() => setIsCaptchaOpen(false)}
        onVerified={handleVerified}
        title="Verify before resending"
        description="Complete this security challenge to resend your verification email."
        submitLabel="Resend Email"
        isLoading={isLoading}
        isSingleStep={true}
      />
    </>
  );
}
