import { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
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
import { verifyEmailToken } from "./actions";

export const metadata: Metadata = {
  title: "Verification Success",
  description: "Your email has been successfully verified.",
};

// Define the PageProps type that follows Next.js App Router standards
type VerificationSearchParams = {
  type?: string;
  token?: string;
  email?: string;
  error_description?: string;
  error?: string;
};

type PageProps = {
  searchParams: Promise<VerificationSearchParams>;
};

export default async function VerificationSuccessPage({
  searchParams,
}: PageProps) {
  // Await the search parameters to resolve the promise
  const resolvedSearchParams = await searchParams;
  const type = resolvedSearchParams.type || "";
  const email = resolvedSearchParams.email; // Get email from URL params
  const token = resolvedSearchParams.token; // Extract token if present
  const errorDescription = resolvedSearchParams.error_description;
  const errorCode = resolvedSearchParams.error;
  
  // Error variables
  let hasError = false;
  let errorMessage = "";
  let verifiedEmail = email || "";
  
  // If we have a token, try to process the verification
  if (token) {
    // Call our server action to verify the email token
    const result = await verifyEmailToken(token);
    
    if (!result.success) {
      hasError = true;
      errorMessage = result.error || "Failed to verify email address.";
    } else if (result.email) {
      verifiedEmail = result.email;
    }
  } else if (errorDescription || errorCode) {
    // Handle case where there's an error param but no token
    hasError = true;
    errorMessage = errorDescription || "Verification error occurred.";
  }
  
  // If we have errors, show the error state
  if (hasError) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <Card className="w-full max-w-md mx-auto mb-12">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <AlertCircle className="h-12 w-12 text-destructive" />
            </div>
            <CardTitle className="text-xl sm:text-2xl">Verification Failed</CardTitle>
            <CardDescription>{errorMessage}</CardDescription>
          </CardHeader>
          <CardContent className="text-center text-muted-foreground">
            <p>The email verification link is invalid or has expired. Please request a new one.</p>
          </CardContent>
          <CardFooter className="flex justify-center gap-2">
            <Link href="/signup">
              <Button>Try Again</Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }
  
  // Show success UI based on type
  let title = "Verification Successful";
  let description = "Your account has been verified successfully.";
  let message = "You can now use all features of Let's Assist.";
  let buttonText = "Go to Home";
  let buttonLink = "/home";
  
  if (type === "signup") {
    title = "Email Verified Successfully!";
    description = verifiedEmail 
      ? `Your email ${verifiedEmail} has been confirmed.`
      : "Your email has been confirmed.";
    message = "Your account is now active. Please log in to complete your profile and start exploring volunteering opportunities.";
    buttonText = "Go to Login";
    buttonLink = verifiedEmail ? `/login?email=${encodeURIComponent(verifiedEmail)}` : '/login';
  } else if (type === "email_change") {
    title = "Email Changed Successfully";
    description = "Your email address has been updated successfully.";
    
    // If we have the verified email, show it
    message = verifiedEmail 
      ? `Your email has been updated to ${verifiedEmail}. Please use this email next time you log in.`
      : "Please use your new email address next time you log in.";
  }
  
  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <Card className="w-full max-w-md mx-auto mb-12">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <CheckCircle2 className="h-12 w-12 text-primary" />
          </div>
          <CardTitle className="text-xl sm:text-2xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="text-center text-muted-foreground">
          <p>{message}</p>
        </CardContent>
        <CardFooter className="flex justify-center gap-2">
          <Link href={buttonLink}>
            <Button>{buttonText}</Button>
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
