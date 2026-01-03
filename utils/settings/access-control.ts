/**
 * Access control utilities for school affiliation system
 * Handles organization-based access restrictions for projects
 */

import { createClient } from "@/utils/supabase/server";

export interface AccessControlResult {
  canAccess: boolean;
  reason?: string;
}

/**
 * Check if user can access a specific project
 * Checks visibility and organization membership
 */
export async function canAccessProject(
  userId: string,
  projectId: string,
): Promise<AccessControlResult> {
  const supabase = await createClient();

  // Get project details
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("visibility, organization_id, creator_id")
    .eq("id", projectId)
    .single();

  if (projectError || !project) {
    return { canAccess: false, reason: "Project not found" };
  }

  // Public and unlisted projects are accessible to everyone
  if (project.visibility === 'public' || project.visibility === 'unlisted') {
    return { canAccess: true };
  }

  // Creator always has access
  if (project.creator_id === userId) {
    return { canAccess: true };
  }

  // Organization-only projects require membership
  if (project.visibility === 'organization_only' && project.organization_id) {
    const { data: membership } = await supabase
      .from("organization_members")
      .select("id")
      .eq("organization_id", project.organization_id)
      .eq("user_id", userId)
      .single();

    if (membership) {
      return { canAccess: true };
    }

    return { 
      canAccess: false, 
      reason: "This project is only accessible to organization members" 
    };
  }

  return { canAccess: true };
}

/**
 * Check if user can create projects
 * All authenticated users can create projects (trusted member check handled elsewhere)
 */
export async function canCreateProject(
  userId: string,
): Promise<AccessControlResult> {
  return { canAccess: true };
}

/**
 * Check if user can view a private profile
 * Organization admins/staff can view member profiles
 */
export async function canViewPrivateProfile(
  viewerId: string,
  profileOwnerId: string,
): Promise<AccessControlResult> {
  // Users can always view their own profile
  if (viewerId === profileOwnerId) {
    return { canAccess: true };
  }

  const supabase = await createClient();

  // Get the profile owner's visibility setting
  const { data: ownerProfile } = await supabase
    .from("profiles")
    .select("email, profile_visibility")
    .eq("id", profileOwnerId)
    .single();

  if (!ownerProfile) {
    return { canAccess: false, reason: "Profile not found" };
  }

  // If profile is public, anyone can view
  if (ownerProfile.profile_visibility === 'public') {
    return { canAccess: true };
  }

  // For private profiles, check if viewer shares an organization with the profile owner
  // Get profile owner's organizations
  const { data: ownerOrgs } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", profileOwnerId);

  if (!ownerOrgs || ownerOrgs.length === 0) {
    return { 
      canAccess: false, 
      reason: "This profile is private" 
    };
  }

  const orgIds = ownerOrgs.map(org => org.organization_id);

  // Check if viewer is admin or staff of any organization the owner belongs to
  const { data: viewerMembership } = await supabase
    .from("organization_members")
    .select("role, organization_id")
    .eq("user_id", viewerId)
    .in("organization_id", orgIds)
    .in("role", ["admin", "staff"]);

  if (viewerMembership && viewerMembership.length > 0) {
    return { canAccess: true };
  }

  return { 
    canAccess: false, 
    reason: "This profile is private" 
  };
}

/**
 * Check if user is a super admin
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  // TODO: Implement super admin check based on your admin system
  // For now, return false - you may have an admin table or role
  return false;
}
