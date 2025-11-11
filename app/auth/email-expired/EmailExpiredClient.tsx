"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertCircle, Mail, RotateCcw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { resendVerificationEmail } from "@/app/signup/actions";
import { toast } from "sonner";

interface EmailExpiredClientProps {
  email: string;
}

export default function EmailExpiredClient({
  email,
}: EmailExpiredClientProps) {
  const [isResending, setIsResending] = useState(false);
  const [hasResent, setHasResent] = useState(false);

  const handleResendEmail = async () => {
    if (!email) {
      toast.error("Email address not found. Please sign up again.");
      return;
    }

    setIsResending(true);
    try {
      const result = await resendVerificationEmail(email);

      if (result.success) {
        setHasResent(true);
        toast.success(result.message || "Verification email resent!");
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
            Your email verification link has expired. This typically happens
            after 24 hours.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert className="border-amber-200 bg-amber-50">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800">
              {email
                ? `We can resend a new verification link to ${email}`
                : "We can send you a new verification link."}
            </AlertDescription>
          </Alert>

          <div className="space-y-3">
            {hasResent ? (
              <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-md">
                <Mail className="h-5 w-5 text-green-600" />
                <p className="text-sm text-green-800">
                  Email resent! Check your inbox and junk folder.
                </p>
              </div>
            ) : null}

            <Button
              onClick={handleResendEmail}
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
    </div>
  );
}
