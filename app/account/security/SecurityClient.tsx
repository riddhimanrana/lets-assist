"use client";

import { Suspense } from "react";
import { PageHeader, SectionHeader } from "@/components/layout/PageHeader";
import { SettingsSection } from "@/components/layout/SettingsSection";
import { Skeleton } from "@/components/ui/skeleton";
import { DataExportSection } from "./DataExportSection";
import { DeleteAccountSection } from "./DeleteAccountSection";
import { GoogleSignInSection } from "./GoogleSignInSection";
import { LoginEmailSection } from "./LoginEmailSection";
import { PasswordSection } from "./PasswordSection";
import { TwoFactorSection } from "./TwoFactorSection";

function GoogleSignInFallback() {
  return (
    <SettingsSection
      title="Google sign-in"
      description="Sign in with your Google account instead of a password."
    >
      <Skeleton className="h-9 w-full" />
    </SettingsSection>
  );
}

/**
 * Sign-in & security: every way to sign in, top to bottom, then data export
 * and account deletion. Each section owns its own state and handlers.
 */
export default function SecurityClient() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Sign-in & security"
        description="Manage how you sign in and keep your account safe."
      />
      <LoginEmailSection />
      <PasswordSection />
      {/* Reads the link callback's search params, so it needs a boundary. */}
      <Suspense fallback={<GoogleSignInFallback />}>
        <GoogleSignInSection />
      </Suspense>
      <TwoFactorSection />
      <SectionHeader
        title="Your data"
        description="Take a copy of your data with you, or close your account."
        className="pt-2"
      />
      <DataExportSection />
      <DeleteAccountSection />
    </div>
  );
}
