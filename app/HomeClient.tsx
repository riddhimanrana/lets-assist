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
  
  useEffect(() => {
    const emailConfirmed = searchParams.get("confirmed");
    const emailDeleted = searchParams.get("deleted");
    
    if (emailConfirmed === "true") {
      toast.success("Success! Email verified. Login to continue.", {
        duration: 5000,
      });
      window.history.replaceState({}, document.title, "/");
    }
    
    if (emailDeleted === "true") {
      toast.error("Your account has been successfully deleted.", {
        duration: 5000,
      });
      window.history.replaceState({}, document.title, "/");
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

/*
"use client";

import { NewHero } from "@/components/NewHero";
import { ComprehensiveFeatures } from "@/components/ComprehensiveFeatures";
import { DiscoverySection } from "@/components/DiscoverySection";
import { CSFDashboardSection } from "@/components/CSFDashboardSection";
import { OrganizationManagementSection } from "@/components/OrganizationManagementSection";
import { QRVerificationSection } from "@/components/QRVerificationSection";
import { FinalCTA } from "@/components/FinalCTA";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Suspense } from "react";

function HomeContent() {
  const searchParams = useSearchParams();
  
  useEffect(() => {
    const emailConfirmed = searchParams.get("confirmed");
    const emailDeleted = searchParams.get("deleted");
    
    if (emailConfirmed === "true") {
      toast.success("Success! Email verified. Login to continue.", {
        duration: 5000,
      });
      window.history.replaceState({}, document.title, "/");
    }
    
    if (emailDeleted === "true") {
      toast.error("Your account has been successfully deleted.", {
        duration: 5000,
      });
      window.history.replaceState({}, document.title, "/");
    }
  }, [searchParams]);
  
  return (
    <main className="flex flex-col min-h-screen overflow-x-hidden">
      <NewHero />
      <ComprehensiveFeatures />
      <DiscoverySection />
      <CSFDashboardSection />
      <OrganizationManagementSection />
      <QRVerificationSection />
      <FinalCTA />
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
  */