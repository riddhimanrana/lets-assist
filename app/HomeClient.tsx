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
