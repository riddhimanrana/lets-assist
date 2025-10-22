"use client";

import { HeroSection } from "@/components/Hero";
import { Features } from "@/components/Features";
import { StudentSection } from "@/components/StudentSection";
import { OrganizationsSection } from "@/components/OrganizationsSection";
import { CallToAction } from "@/components/CallToAction";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Check for error parameters
  const error = searchParams.get("error");
  const errorCode = searchParams.get("error_code");
  const errorDescription = searchParams.get("error_description");

  // Show error page if there's an error
  if (error && errorDescription) {
    // Decode URL-encoded error description
    const decodedDescription = decodeURIComponent(errorDescription);
    
    // Show different messages based on error code
    let message = decodedDescription;
    if (errorCode === "otp_expired") {
      message = "Email link is invalid or has expired. Please request a new confirmation email.";
    } else if (errorCode === "invalid_grant") {
      message = "This link is no longer valid. Please request a new confirmation email.";
    }

    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-[380px] shadow-lg">
          <CardHeader className="text-center">
            <CardTitle className="flex items-center justify-center gap-2 text-destructive">
              <AlertCircle className="h-6 w-6" />
              Email Verification Error
            </CardTitle>
          </CardHeader>
          <CardContent className="text-center text-muted-foreground">
            <p className="text-sm font-mono text-destructive mb-2">{message}</p>
            <p>Please try again or contact support if the issue persists.</p>
          </CardContent>
          <CardFooter className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => router.push("/login")}>
              Back to Login
            </Button>
            <Button onClick={() => router.push("/")}>Go to Home</Button>
          </CardFooter>
        </Card>
      </div>
    );
  }
  
  return (
    <main className="flex flex-col min-h-screen overflow-x-hidden">
      <HeroSection />
      <Features />
      <StudentSection />
      <OrganizationsSection />
      <CallToAction />
    </main>
  );
}

export default function HomeClient() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-pulse">Loading...</div>
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
