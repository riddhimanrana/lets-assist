/**
 * Domain-based Organization Utilities
 * 
 * Helper functions for checking email domains linked to organizations.
 */

import { createClient } from "@/utils/supabase/server";

/**
 * Check if an email domain is linked to an organization with auto-join
 */
export async function getOrganizationByEmailDomain(email: string) {
  if (!email) return null;
  
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  
  const supabase = await createClient();
  
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, username, auto_join_domain")
    .eq("auto_join_domain", domain)
    .single();
  
  return org;
}

/**
 * Default profile visibility for new accounts
 */
export function getDefaultProfileVisibility(): 'public' | 'private' {
  return 'public';
}

/**
 * Check if user can create organizations
 * All users can create organizations (trusted member check handled elsewhere)
 */
export function canCreateOrganization(): boolean {
  return true;
}
