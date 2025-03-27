import { createClient } from "./supabase/server";

/**
 * Check if a user has permission to create projects for an organization
 */
export async function hasOrgProjectPermission(userId: string, organizationId: string): Promise<boolean> {
  if (!userId || !organizationId) return false;
  
  const supabase = await createClient();
  
  const { data, error } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .single();
    
  if (error || !data) return false;
  
  // Only admin and staff roles can create projects
  return data.role === "admin" || data.role === "staff";
}

/**
 * Get organization details if a user has permission to create projects
 */
export async function getOrgForProjectCreation(userId: string, organizationId: string) {
  if (!userId || !organizationId) return null;
  
  const hasPermission = await hasOrgProjectPermission(userId, organizationId);
  if (!hasPermission) return null;
  
  const supabase = await createClient();
  
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, logo_url")
    .eq("id", organizationId)
    .single();
    
  if (error || !data) return null;
  
  return data;
}
