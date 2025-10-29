/**
 * Access control utilities for CIPA compliance
 * Handles age-based access restrictions for projects and features
 */

import { calculateAge, isUnder13 } from "@/utils/age-helpers";
import { createClient } from "@/utils/supabase/server";

export interface AccessControlResult {
  canAccess: boolean;
  reason?: string;
  requiresParentalConsent?: boolean;
}

/**
 * Check if user can access a specific project
 * Under 13 users need parental consent
 */
export async function canAccessProject(
  userId: string,
  projectId: string,
): Promise<AccessControlResult> {
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("date_of_birth, parental_consent_verified")
    .eq("id", userId)
    .single();

  if (!profile) {
    return { canAccess: false, reason: "Profile not found" };
  }

  // If under 13 and no parental consent, block access
  if (isUnder13(profile.date_of_birth)) {
    if (!profile.parental_consent_verified) {
      return {
        canAccess: false,
        reason: "Parental consent required to access events",
        requiresParentalConsent: true,
      };
    }
  }

  return { canAccess: true };
}

/**
 * Check if user can create projects
 * Must be 13+ to create projects
 */
export async function canCreateProject(
  userId: string,
): Promise<AccessControlResult> {
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("date_of_birth")
    .eq("id", userId)
    .single();

  if (!profile?.date_of_birth) {
    // No age restriction for regular accounts without DOB
    return { canAccess: true };
  }

  if (isUnder13(profile.date_of_birth)) {
    return {
      canAccess: false,
      reason: "Must be 13 or older to create projects",
    };
  }

  return { canAccess: true };
}

/**
 * Check if user needs to provide parental consent
 */
export async function needsParentalConsent(userId: string): Promise<boolean> {
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("date_of_birth, parental_consent_verified")
    .eq("id", userId)
    .single();

  if (!profile?.date_of_birth) return false;

  return isUnder13(profile.date_of_birth) && !profile.parental_consent_verified;
}

/**
 * Check if user is restricted (under 13 without consent)
 */
export async function isAccountRestricted(userId: string): Promise<boolean> {
  return needsParentalConsent(userId);
}

/**
 * Global access guard for protected routes
 * Redirects to appropriate onboarding/consent pages if needed
 * Returns null if access is granted, or redirect URL if user needs onboarding
 */
export async function checkUserAccess(userId: string): Promise<{
  canAccess: boolean;
  redirectTo?: string;
  reason?: string;
}> {
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "date_of_birth, parental_consent_required, parental_consent_verified, email",
    )
    .eq("id", userId)
    .single();

  if (!profile) {
    return {
      canAccess: false,
      redirectTo: "/login",
      reason: "Profile not found",
    };
  }

  // Check if user needs DOB onboarding (institution accounts)
  if (!profile.date_of_birth && profile.email) {
    const supabaseForEmail = await createClient();
    const domain = profile.email.split("@")[1]?.toLowerCase();

    if (domain) {
      const { data: institution } = await supabaseForEmail
        .from("educational_institutions")
        .select("id")
        .eq("domain", domain)
        .eq("verified", true)
        .single();

      if (institution) {
        return {
          canAccess: false,
          redirectTo: "/auth/dob-onboarding",
          reason: "Date of birth required for institution accounts",
        };
      }
    }
  }

  // Check if user needs parental consent
  if (profile.parental_consent_required && !profile.parental_consent_verified) {
    return {
      canAccess: false,
      redirectTo: "/account/parental-consent",
      reason: "Parental consent required",
    };
  }

  return { canAccess: true };
}
