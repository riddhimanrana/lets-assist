"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function VerificationContent() {
  const searchParams = useSearchParams();
  const [errorInfo, setErrorInfo] = useState<{ message: string; code: string } | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  const type = searchParams.get("type") || "";
  const email = searchParams.get("email");
  const errorParam = searchParams.get("error");
  const errorDescriptionParam = searchParams.get("error_description");

  useEffect(() => {
    // Check for errors in the URL hash (fragment) which Supabase often uses
    const hash = window.location.hash;
    let foundError = null;

    if (hash) {
      const params = new URLSearchParams(hash.substring(1));
      const error = params.get("error");
      const errorCode = params.get("error_code");
      const errorDescription = params.get("error_description");

      if (error || errorCode || errorDescription) {
        foundError = {
          code: errorCode || error || "unknown",
          message: errorDescription?.replace(/\+/g, " ") || "Verification link is invalid or has expired.",
        };
      }
    } else if (errorParam || errorDescriptionParam) {
      // Also check search params as fallback
      foundError = {
        code: errorParam || "unknown",
        message: errorDescriptionParam || "Verification error occurred.",
      };
    }

    if (foundError) {
      setErrorInfo(foundError);
    }
    setIsChecking(false);
  }, [errorParam, errorDescriptionParam]);

  // While checking the hash, show a loading state to prevent the "flash of success"
  if (isChecking) {
    return (
      <div className="flex items-center justify-center min-h-[80vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // If we have an error, show the error state
  if (errorInfo) {
    return (
      <div className="flex items-center justify-center min-h-[80vh] p-4">
        <Card className="w-full max-w-md mx-auto">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <AlertCircle className="h-12 w-12 text-destructive" />
            </div>
            <CardTitle className="text-xl sm:text-2xl">Verification Failed</CardTitle>
            <CardDescription>{errorInfo.message}</CardDescription>
          </CardHeader>
          <CardContent className="text-center text-muted-foreground">
            <p>The email verification link is invalid or has expired. Please request a new one by trying to sign in or signing up again.</p>
          </CardContent>
          <CardFooter className="flex justify-center gap-2">
            <Link href="/login">
              <Button variant="outline">Back to Login</Button>
            </Link>
            <Link href="/signup">
              <Button>Try Signup Again</Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // Success UI
  let title = "Verification Successful";
  let description = email
    ? `Your email ${email} has been verified successfully.`
    : "Your account has been verified successfully.";
  let message = "You can now use all features of Let's Assist.";
  let buttonText = "Go to Home";
  let buttonLink = "/home";

  if (type === "signup") {
    title = "Email Verified Successfully!";
    description = email
      ? `Your email ${email} has been confirmed.`
      : "Your email has been confirmed.";
    message = "Your account is now active. Please log in to complete your profile and start exploring volunteering opportunities.";
    buttonText = "Go to Login";
    buttonLink = email ? `/login?email=${encodeURIComponent(email)}` : '/login';
  } else if (type === "email_change") {
    title = "Email Change Confirmed";
    description = email
      ? `Your email ${email} was confirmed successfully.`
      : "Your new email has been confirmed.";
    message = "Sign in again using the updated email to continue.";
    buttonText = "Go to Login";
    buttonLink = email ? `/login?email=${encodeURIComponent(email)}` : "/login";
  }

  return (
    <div className="flex items-center justify-center min-h-[80vh] p-4">
      <Card className="w-full max-w-md mx-auto">
        <CardHeader className="text-center">
          <div className="flex flex-col justify-center items-center space-y-4">
            <CheckCircle2 className="h-12 w-12 text-success" />
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="text-center text-muted-foreground">
          <p>{message}</p>
        </CardContent>
        <CardFooter className="flex justify-center">
          <Link href={buttonLink}>
            <Button className="w-full sm:w-auto">{buttonText}</Button>
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}

export default function VerificationSuccessClient() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[80vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    }>
      <VerificationContent />
    </Suspense>
  );
}
