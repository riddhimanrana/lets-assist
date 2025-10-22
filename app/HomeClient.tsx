"use client";

import { HeroSection } from "@/components/Hero";
import { Features } from "@/components/Features";
import { StudentSection } from "@/components/StudentSection";
import { OrganizationsSection } from "@/components/OrganizationsSection";
import { CallToAction } from "@/components/CallToAction";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Suspense } from "react";

function HomeContent() {
  const searchParams = useSearchParams();

  // Display error messages from URL parameters
  useEffect(() => {
    const error = searchParams.get("error");
    const errorCode = searchParams.get("error_code");
    const errorDescription = searchParams.get("error_description");

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

      toast.error(message);
    }
  }, [searchParams]);
  
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
