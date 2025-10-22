'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Mail } from 'lucide-react';
import { resendVerificationEmail } from '../actions';
import { toast } from 'sonner';

interface ResendVerificationButtonProps {
  email: string;
}

export function ResendVerificationButton({ email }: ResendVerificationButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [canResend, setCanResend] = useState(false);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      setCanResend(true);
    }
  }, [countdown]);

  const handleResend = async () => {
    setIsLoading(true);
    
    try {
      const result = await resendVerificationEmail(email);
      
      if (result.success) {
        toast.success(result.message || 'Verification email sent!');
        setCountdown(60);
        setCanResend(false);
      } else {
        toast.error(result.error || 'Failed to resend email');
      }
    } catch (error) {
      toast.error('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      onClick={handleResend}
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
  );
}
