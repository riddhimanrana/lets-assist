interface TurnstileVerificationResponse {
  success: boolean;
  "error-codes"?: string[];
  challenge_ts?: string;
  hostname?: string;
}

import { logError } from '@/lib/logger';

export async function verifyTurnstileToken(token: string): Promise<boolean> {
  const shouldBypass = process.env.NODE_ENV !== "production" && process.env.TURNSTILE_BYPASS === "true";

  if (shouldBypass) {
    return true;
  }

  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  
  if (!secretKey) {
    logError('Turnstile secret key is not configured', new Error('Missing TURNSTILE_SECRET_KEY'));
    return false;
  }

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        secret: secretKey,
        response: token,
      }),
    });

    const data: TurnstileVerificationResponse = await response.json();
    
    if (!data.success) {
      logError('Turnstile verification failed', new Error('Verification failed'), {
        error_codes: data["error-codes"]?.join(', '),
      });
      return false;
    }

    return true;
  } catch (error) {
    logError('Exception while verifying Turnstile token', error);
    return false;
  }
}

export function isTurnstileEnabled(): boolean {
  const shouldBypass = process.env.NODE_ENV !== "production" && process.env.TURNSTILE_BYPASS === "true";
  return !shouldBypass && !!(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY);
}
