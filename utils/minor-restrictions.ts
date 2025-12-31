/**
 * School Account Utilities
 * 
 * Helper functions for identifying school accounts based on email domain.
 * School accounts have some different default settings for privacy.
 */

import { createClient } from "@/utils/supabase/server";

/**
 * Check if an email belongs to a verified educational institution
 */
export async function isSchoolEmail(email: string): Promise<boolean> {
  if (!email) return false;
  
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  
  const supabase = await createClient();
  
  const { data: institution } = await supabase
    .from("educational_institutions")
    .select("id")
    .eq("domain", domain)
    .eq("verified", true)
    .single();
  
  return !!institution;
}

/**
 * Get the institution info for a school email
 */
export async function getInstitutionByEmail(email: string) {
  if (!email) return null;
  
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  
  const supabase = await createClient();
  
  const { data: institution } = await supabase
    .from("educational_institutions")
    .select("id, name, domain, type")
    .eq("domain", domain)
    .eq("verified", true)
    .single();
  
  return institution;
}

/**
 * Default profile visibility for new accounts
 * School accounts default to private for better privacy
 */
export function getDefaultProfileVisibility(isSchoolAccount: boolean): 'public' | 'private' {
  return isSchoolAccount ? 'private' : 'public';
}

/**
 * Check if user can create organizations
 * School accounts (students) typically can't create orgs - they join via staff links
 */
export function canCreateOrganization(isSchoolAccount: boolean): boolean {
  return !isSchoolAccount;
}
