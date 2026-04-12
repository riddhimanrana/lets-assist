"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { getRegisteredPlugin, listRegisteredPlugins } from "@/lib/plugins/registry";
import { buildOrganizationPluginAdminSettings } from "@/lib/plugins/organization-plugin-settings";
import {
  applyConfigDefaults,
  validatePluginConfig,
  type PluginConfigSchema,
} from "@/lib/plugins/config-schema";
import type { OrganizationPluginAdminSetting } from "@/types";

// Allowed image MIME types
const ALLOWED_FILE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];

// Max file size (5MB)
const MAX_FILE_SIZE = 5 * 1024 * 1024;

type OrganizationUpdateData = {
  id: string;
  name: string;
  username: string;
  description: string | undefined;
  website: string | undefined;
  type: 'nonprofit' | 'school' | 'company' | 'government' | 'other';
  logoUrl: string | null | undefined;
  autoJoinDomain?: string | null;
  showMembersPublicly?: boolean;
};

/**
 * Check if an organization username is available (excluding the current org's username)
 */
export async function checkUsernameAvailability(username: string): Promise<boolean> {
  const supabase = await createClient();
  
  if (!username || username.length < 3) {
    return false;
  }
  
  const { data, error } = await supabase
    .from("organizations")
    .select("username")
    .eq("username", username)
    .maybeSingle();
  
  if (error) {
    console.error("Error checking username availability:", error);
    return false;
  }
  
  return !data; // If data is null, username is available
}

/**
 * Check if a domain is available for auto-join (not used by another organization)
 * Excludes the specified organization from the check
 */
export async function checkDomainAvailability(domain: string, excludeOrgId?: string): Promise<boolean> {
  const supabase = await createClient();

  const normalizedDomain = domain.toLowerCase().trim();
  if (!normalizedDomain) {
    return false;
  }

  // Require at least one dot, prevent consecutive dots, and ensure labels don't start/end with hyphens.
  // Examples: example.org, school.k12.us
  const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
  if (!domainPattern.test(normalizedDomain)) {
    return false;
  }

  let query = supabase
    .from("organizations")
    .select("id")
    .eq("auto_join_domain", normalizedDomain);
  
  if (excludeOrgId) {
    query = query.neq("id", excludeOrgId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error("Error checking domain:", error);
    return false;
  }

  return !data; // If data is null, domain is available
}

/**
 * Update an organization's details
 */
export async function updateOrganization(data: OrganizationUpdateData) {
  const supabase = await createClient();

  // Verify that user is authenticated using getClaims() for better performance
  const { user } = await getAuthUser();
  if (!user) {
    return { error: "You must be logged in to update an organization" };
  }

  // Verify the user is an admin of the organization
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", data.id)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .single();

  if (!membership) {
    return { error: "Only admins can update organization details" };
  }

  // Get the current organization data
  const { data: currentOrg, error: orgError } = await supabase
    .from("organizations")
    .select("username, logo_url")
    .eq("id", data.id)
    .single();

  if (orgError || !currentOrg) {
    console.error("Error fetching organization:", orgError);
    return { error: "Organization not found" };
  }

  try {
    let logoUrl = currentOrg.logo_url;
    
    // Handle logo update
    if (data.logoUrl !== undefined) {
      // Case: Logo was explicitly set to null - remove the current logo
      if (data.logoUrl === null) {
        logoUrl = null;
        
        // If there was a previous logo, delete it from storage
        if (currentOrg.logo_url) {
          try {
            const fileName = currentOrg.logo_url.split('/').pop();
            if (fileName) {
              await supabase.storage.from('organization-logos').remove([fileName]);
            }
          } catch (error) {
            console.error("Error removing old logo:", error);
            // Continue even if logo deletion fails
          }
        }
      } 
      // Case: New logo provided
      else if (data.logoUrl && data.logoUrl.startsWith('data:')) {
        // Extract the MIME type and verify it's allowed
        const mimeType = data.logoUrl.split(';')[0].split(':')[1];
        
        if (!ALLOWED_FILE_TYPES.includes(mimeType)) {
          return { error: "Invalid file type. Allowed types: JPEG, PNG, WebP" };
        }
        
        // Extract the base64 content and determine file extension
        const base64Data = data.logoUrl.split(',')[1];
        
        // Size check
        const approxFileSize = (base64Data.length * 0.75);
        if (approxFileSize > MAX_FILE_SIZE) {
          return { error: "File size exceeds the 5MB limit" };
        }
        
        // Determine file extension from MIME type
        let fileExt;
        if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
          fileExt = 'jpg';
        } else if (mimeType === 'image/png') {
          fileExt = 'png';
        } else if (mimeType === 'image/webp') {
          fileExt = 'webp';
        } else {
          fileExt = 'jpg';
        }
        
        // File name based on organization ID
        const fileName = `${data.id}.${fileExt}`;
        
        // Delete previous logo if it exists
        if (currentOrg.logo_url) {
          try {
            const oldFileName = currentOrg.logo_url.split('/').pop();
            if (oldFileName && oldFileName !== fileName) {
              await supabase.storage.from('organization-logos').remove([oldFileName]);
            }
          } catch (error) {
            console.error("Error removing old logo:", error);
            // Continue even if logo deletion fails
          }
        }
        
        // Upload new logo
        const { error: uploadError } = await supabase.storage
          .from('organization-logos')
          .upload(fileName, Buffer.from(base64Data, 'base64'), {
            contentType: mimeType,
            upsert: true
          });
        
        if (uploadError) throw uploadError;
        
        // Get public URL for the uploaded image
        const { data: publicUrlData } = supabase.storage
          .from('organization-logos')
          .getPublicUrl(fileName);
        
        logoUrl = publicUrlData.publicUrl;
      }
    }

    // Update the organization
    const { error: updateError } = await supabase
      .from("organizations")
      .update({
        name: data.name,
        username: data.username,
        description: data.description || null,
        website: data.website || null,
        type: data.type,
        logo_url: logoUrl,
        auto_join_domain: data.autoJoinDomain || null,
        show_members_publicly: data.showMembersPublicly !== false,
      })
      .eq("id", data.id);

    if (updateError) throw updateError;
    
    // Revalidate paths
    revalidatePath(`/organization/${currentOrg.username}`);
    revalidatePath(`/organization/${data.username}`);
    revalidatePath('/organization');
    
    return { success: true };
  } catch (error) {
    console.error("Error updating organization:", error);
    return { error: error instanceof Error ? error.message : "Failed to update organization" };
  }
}

/**
 * Delete an organization permanently
 */
export async function deleteOrganization(organizationId: string) {
  const supabase = await createClient();

  // Verify that user is authenticated using getClaims() for better performance
  const { user } = await getAuthUser();
  if (!user) {
    return { error: "You must be logged in to delete an organization" };
  }

  // Verify the user is an admin of the organization
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .single();

  if (!membership) {
    return { error: "Only admins can delete organizations" };
  }

  try {
    // Get organization info for logo deletion
    const { data: organization } = await supabase
      .from("organizations")
      .select("logo_url")
      .eq("id", organizationId)
      .single();
    
    // Delete the organization logo if it exists
    if (organization?.logo_url) {
      try {
        const fileName = organization.logo_url.split('/').pop();
        if (fileName) {
          await supabase.storage.from('organization-logos').remove([fileName]);
        }
      } catch (error) {
        console.error("Error removing organization logo:", error);
        // Continue even if logo deletion fails
      }
    }
    
    // Delete the organization (cascade should handle related data)
    const { error: deleteError } = await supabase
      .from("organizations")
      .delete()
      .eq("id", organizationId);

    if (deleteError) {
      console.error("Error deleting organization from database:", deleteError);
      throw deleteError;
    }
    
    // Revalidate paths
    revalidatePath('/organization');
    
    return { success: true };
  } catch (error) {
    console.error("Error deleting organization:", error);
    return { error: error instanceof Error ? error.message : "Failed to delete organization" };
  }
}

/**
 * Generate a staff invite link for an organization
 * This link allows teachers/staff to join directly with staff role
 */
export async function generateStaffLink(organizationId: string, expiresInDays: number = 30) {
  const supabase = await createClient();

  // Verify that user is authenticated using getClaims() for better performance
  const { user } = await getAuthUser();
  if (!user) {
    return { error: "You must be logged in to generate staff links" };
  }

  // Verify the user is an admin of the organization
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .single();

  if (!membership) {
    return { error: "Only admins can generate staff invite links" };
  }

  try {
    // Generate a new UUID token
    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    // Update the organization with the new staff token
    const { error: updateError } = await supabase
      .from("organizations")
      .update({
        staff_join_token: token,
        staff_join_token_created_at: new Date().toISOString(),
        staff_join_token_expires_at: expiresAt.toISOString(),
      })
      .eq("id", organizationId);

    if (updateError) {
      console.error("Error generating staff link:", updateError);
      throw updateError;
    }

    // Revalidate the settings page
    revalidatePath(`/organization/${organizationId}/settings`);

    return { 
      success: true, 
      token,
      expiresAt: expiresAt.toISOString(),
    };
  } catch (error) {
    console.error("Error generating staff link:", error);
    return { error: error instanceof Error ? error.message : "Failed to generate staff link" };
  }
}

/**
 * Revoke the staff invite link for an organization
 */
export async function revokeStaffLink(organizationId: string) {
  const supabase = await createClient();

  // Verify that user is authenticated using getClaims() for better performance
  const { user } = await getAuthUser();
  if (!user) {
    return { error: "You must be logged in to revoke staff links" };
  }

  // Verify the user is an admin of the organization
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .single();

  if (!membership) {
    return { error: "Only admins can revoke staff invite links" };
  }

  try {
    const { error: updateError } = await supabase
      .from("organizations")
      .update({
        staff_join_token: null,
        staff_join_token_created_at: null,
        staff_join_token_expires_at: null,
      })
      .eq("id", organizationId);

    if (updateError) {
      console.error("Error revoking staff link:", updateError);
      throw updateError;
    }

    // Revalidate the settings page
    revalidatePath(`/organization/${organizationId}/settings`);

    return { success: true };
  } catch (error) {
    console.error("Error revoking staff link:", error);
    return { error: error instanceof Error ? error.message : "Failed to revoke staff link" };
  }
}

/**
 * Get staff link details for an organization
 */
export async function getStaffLinkDetails(organizationId: string) {
  const supabase = await createClient();

  // Verify that user is authenticated using getClaims() for better performance
  const { user } = await getAuthUser();
  if (!user) {
    return { error: "You must be logged in to view staff link details" };
  }

  // Verify the user is an admin of the organization
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .single();

  if (!membership) {
    return { error: "Only admins can view staff link details" };
  }

  try {
    const { data: org, error } = await supabase
      .from("organizations")
      .select("staff_join_token, staff_join_token_created_at, staff_join_token_expires_at")
      .eq("id", organizationId)
      .single();

    if (error || !org) {
      throw error ?? new Error("Organization not found");
    }

    // Check if token is expired
    const isExpired = org.staff_join_token_expires_at 
      ? new Date(org.staff_join_token_expires_at) < new Date()
      : false;

    return {
      hasToken: !!org.staff_join_token && !isExpired,
      token: isExpired ? null : org.staff_join_token,
      createdAt: org.staff_join_token_created_at,
      expiresAt: org.staff_join_token_expires_at,
      isExpired,
    };
  } catch (error) {
    console.error("Error getting staff link details:", error);
    return { error: error instanceof Error ? error.message : "Failed to get staff link details" };
  }
}

type PluginCatalogRow = {
  key: string;
  name: string;
  description: string | null;
  visibility: "global" | "private";
  is_active: boolean;
  latest_version: string;
  force_update_version: string | null;
  code_repository: string | null;
  code_reference: string | null;
  private_codebase: boolean;
  updated_at: string | null;
};

type PluginEntitlementRow = {
  plugin_key: string;
  status: "active" | "inactive";
  starts_at: string | null;
  ends_at: string | null;
};

type PluginInstallRow = {
  plugin_key: string;
  enabled: boolean;
  installed_version: string | null;
  configuration: Record<string, unknown> | null;
};

type PluginAccessRow = {
  plugin_key: string;
  enabled: boolean;
  installed_version: string | null;
  configuration: Record<string, unknown> | null;
  install_created_at: string | null;
  entitlement_status: "active" | "inactive" | null;
  entitlement_starts_at: string | null;
  entitlement_ends_at: string | null;
};

type SupabaseLikeError = {
  code?: string;
  message?: string;
};

export type OrganizationPluginSettingsResult = {
  plugins: OrganizationPluginAdminSetting[];
  warning?: string;
  error?: string;
};

function isMissingPluginTableError(error: SupabaseLikeError | null): boolean {
  if (!error) return false;

  const message =
    typeof error.message === "string" ? error.message.toLowerCase() : "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    error.code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("could not find the table") ||
    message.includes("could not find the relation")
  );
}

function isPlainObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function isOrganizationAdminForSettings(
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const supabase = await createClient();
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("role", "admin")
    .single();

  return Boolean(membership);
}

export async function getOrganizationPluginSettings(
  organizationId: string,
): Promise<OrganizationPluginSettingsResult> {
  const supabase = await createClient();
  const { user } = await getAuthUser();

  if (!user) {
    return { plugins: [], error: "You must be logged in to view plugin settings" };
  }

  const isAdmin = await isOrganizationAdminForSettings(organizationId, user.id);
  if (!isAdmin) {
    return { plugins: [], error: "Only organization admins can manage plugins" };
  }

  const [catalogResult, accessResult] = await Promise.all([
    supabase
      .from("plugins")
      .select(
        "key, name, description, visibility, is_active, latest_version, force_update_version, code_repository, code_reference, private_codebase, updated_at",
      )
      .eq("is_active", true),
    supabase
      .from("organization_plugin_access")
      .select(
        "plugin_key, enabled, installed_version, configuration, install_created_at, entitlement_status, entitlement_starts_at, entitlement_ends_at",
      )
      .eq("organization_id", organizationId),
  ]);

  if (
    isMissingPluginTableError(catalogResult.error) ||
    isMissingPluginTableError(accessResult.error)
  ) {
    const [entitlementResult, installResult] = await Promise.all([
      supabase
        .from("organization_plugin_entitlements")
        .select("plugin_key, status, starts_at, ends_at")
        .eq("organization_id", organizationId),
      supabase
        .from("organization_plugin_installs")
        .select("plugin_key, enabled, installed_version, configuration")
        .eq("organization_id", organizationId),
    ]);

    if (
      isMissingPluginTableError(entitlementResult.error) ||
      isMissingPluginTableError(installResult.error)
    ) {
      return {
        plugins: [],
        warning:
          "Plugin platform tables are not initialized in this environment yet. Run a local Supabase reset after applying migrations.",
      };
    }

    if (catalogResult.error) {
      return { plugins: [], error: `Failed to load plugin catalog: ${catalogResult.error.message}` };
    }

    if (entitlementResult.error) {
      return {
        plugins: [],
        error: `Failed to load plugin entitlements: ${entitlementResult.error.message}`,
      };
    }

    if (installResult.error) {
      return {
        plugins: [],
        error: `Failed to load plugin installs: ${installResult.error.message}`,
      };
    }

    const runtimePlugins = listRegisteredPlugins().map((plugin) => ({
      key: plugin.manifest.key,
      navLabel: plugin.manifest.navLabel ?? plugin.manifest.name,
      version: plugin.manifest.version,
      minimumRole: plugin.manifest.minimumRole ?? "member",
      ownerName: plugin.manifest.owner?.name ?? "Let's Assist",
      ownerType: plugin.manifest.owner?.type ?? "platform-official",
      detailedDescription:
        plugin.manifest.detailedDescription ??
        plugin.manifest.description ??
        `${plugin.manifest.name} plugin for organization workflows.`,
      capabilityHighlights: plugin.manifest.capabilityHighlights ?? [],
      dataAccess: plugin.manifest.dataScope ?? [],
      configSchema: plugin.manifest.configSchema ?? null,
      requiredScopes: plugin.manifest.requiredScopes ?? [],
    }));

    const plugins = buildOrganizationPluginAdminSettings({
      catalog: (catalogResult.data ?? []) as PluginCatalogRow[],
      entitlements: (entitlementResult.data ?? []) as PluginEntitlementRow[],
      installs: (installResult.data ?? []) as PluginInstallRow[],
      runtimePlugins,
    });

    return { plugins };
  }

  if (catalogResult.error) {
    return { plugins: [], error: `Failed to load plugin catalog: ${catalogResult.error.message}` };
  }

  if (accessResult.error) {
    return {
      plugins: [],
      error: `Failed to load consolidated plugin access: ${accessResult.error.message}`,
    };
  }

  const runtimePlugins = listRegisteredPlugins().map((plugin) => ({
    key: plugin.manifest.key,
    navLabel: plugin.manifest.navLabel ?? plugin.manifest.name,
    version: plugin.manifest.version,
    minimumRole: plugin.manifest.minimumRole ?? "member",
    ownerName: plugin.manifest.owner?.name ?? "Let's Assist",
    ownerType: plugin.manifest.owner?.type ?? "platform-official",
    detailedDescription:
      plugin.manifest.detailedDescription ??
      plugin.manifest.description ??
      `${plugin.manifest.name} plugin for organization workflows.`,
    capabilityHighlights: plugin.manifest.capabilityHighlights ?? [],
    dataAccess: plugin.manifest.dataScope ?? [],
    configSchema: plugin.manifest.configSchema ?? null,
    requiredScopes: plugin.manifest.requiredScopes ?? [],
  }));

  const accessRows = (accessResult.data ?? []) as PluginAccessRow[];

  const entitlements = accessRows
    .filter((row) => row.entitlement_status !== null)
    .map((row) => ({
      plugin_key: row.plugin_key,
      status: row.entitlement_status as "active" | "inactive",
      starts_at: row.entitlement_starts_at,
      ends_at: row.entitlement_ends_at,
    })) as PluginEntitlementRow[];

  const installs = accessRows
    .filter((row) => row.install_created_at !== null)
    .map((row) => ({
      plugin_key: row.plugin_key,
      enabled: row.enabled,
      installed_version: row.installed_version,
      configuration: row.configuration,
    })) as PluginInstallRow[];

  const plugins = buildOrganizationPluginAdminSettings({
    catalog: (catalogResult.data ?? []) as PluginCatalogRow[],
    entitlements,
    installs,
    runtimePlugins,
  });

  return { plugins };
}

export async function setOrganizationPluginInstallState(options: {
  organizationId: string;
  pluginKey: string;
  enabled: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const { organizationId, pluginKey, enabled } = options;
  const { user } = await getAuthUser();

  if (!user) {
    return { success: false, error: "You must be logged in to manage plugins" };
  }

  const adminSupabase = getAdminClient();

  const isAdmin = await isOrganizationAdminForSettings(organizationId, user.id);
  if (!isAdmin) {
    return { success: false, error: "Only organization admins can manage plugins" };
  }

  const definition = getRegisteredPlugin(pluginKey);
  if (!definition) {
    return {
      success: false,
      error:
        "This plugin package is not loaded in the current deployment yet. Please try again in a moment.",
    };
  }

  const { data: pluginCatalog, error: pluginCatalogError } = (await adminSupabase
    .from("plugins")
    .select("key, visibility, is_active, latest_version")
    .eq("key", pluginKey)
    .eq("is_active", true)
    .maybeSingle()) as {
    data: {
      key: string;
      visibility: "global" | "private";
      is_active: boolean;
      latest_version: string;
    } | null;
    error: SupabaseLikeError | null;
  };

  if (isMissingPluginTableError(pluginCatalogError)) {
    return {
      success: false,
      error: "Plugin platform tables are not initialized in this environment yet.",
    };
  }

  if (pluginCatalogError) {
    return {
      success: false,
      error: `Failed to validate plugin availability: ${pluginCatalogError.message}`,
    };
  }

  if (!pluginCatalog) {
    return { success: false, error: "Plugin is not active in the catalog." };
  }

  if (pluginCatalog.visibility !== "global") {
    return {
      success: false,
      error:
        "Private plugins are managed by the Let's Assist team. Contact support for changes.",
    };
  }

  const { data: existingInstall, error: existingInstallError } = (await adminSupabase
    .from("organization_plugin_installs")
    .select("organization_id, plugin_key")
    .eq("organization_id", organizationId)
    .eq("plugin_key", pluginKey)
    .maybeSingle()) as {
    data: { organization_id: string; plugin_key: string } | null;
    error: SupabaseLikeError | null;
  };

  if (existingInstallError) {
    return {
      success: false,
      error: `Failed to load current install state: ${existingInstallError.message}`,
    };
  }

  const now = new Date().toISOString();

  if (enabled) {
    if (existingInstall) {
      const { error: updateError } = await adminSupabase
        .from("organization_plugin_installs")
        .update({
          enabled: true,
          installed_version: pluginCatalog.latest_version,
          updated_at: now,
        })
        .eq("organization_id", organizationId)
        .eq("plugin_key", pluginKey);

      if (updateError) {
        return { success: false, error: `Failed to enable plugin: ${updateError.message}` };
      }
    } else {
      const { error: insertError } = await adminSupabase
        .from("organization_plugin_installs")
        .insert({
          organization_id: organizationId,
          plugin_key: pluginKey,
          enabled: true,
          installed_version: pluginCatalog.latest_version,
          installed_at: now,
          updated_at: now,
        });

      if (insertError) {
        return { success: false, error: `Failed to install plugin: ${insertError.message}` };
      }
    }
  } else if (existingInstall) {
    const { error: updateError } = await adminSupabase
      .from("organization_plugin_installs")
      .update({
        enabled: false,
        updated_at: now,
      })
      .eq("organization_id", organizationId)
      .eq("plugin_key", pluginKey);

    if (updateError) {
      return { success: false, error: `Failed to disable plugin: ${updateError.message}` };
    }
  }

  const { data: organization } = await adminSupabase
    .from("organizations")
    .select("id, username")
    .eq("id", organizationId)
    .maybeSingle();

  if (organization) {
    const organizationSlug = organization.username || organization.id;
    revalidatePath(`/organization/${organizationSlug}`);
    revalidatePath(`/organization/${organizationSlug}/settings`);
  }

  revalidatePath(`/organization/${organizationId}`);
  revalidatePath(`/organization/${organizationId}/settings`);

  return { success: true };
}

export async function uninstallOrganizationPlugin(options: {
  organizationId: string;
  pluginKey: string;
}): Promise<{ success: boolean; error?: string }> {
  const { organizationId, pluginKey } = options;
  const { user } = await getAuthUser();

  if (!user) {
    return { success: false, error: "You must be logged in to manage plugins" };
  }

  const adminSupabase = getAdminClient();
  const isAdmin = await isOrganizationAdminForSettings(organizationId, user.id);

  if (!isAdmin) {
    return { success: false, error: "Only organization admins can manage plugins" };
  }

  const { data: pluginCatalog, error: pluginCatalogError } = (await adminSupabase
    .from("plugins")
    .select("key, visibility")
    .eq("key", pluginKey)
    .maybeSingle()) as {
    data: {
      key: string;
      visibility: "global" | "private";
    } | null;
    error: SupabaseLikeError | null;
  };

  if (isMissingPluginTableError(pluginCatalogError)) {
    return {
      success: false,
      error: "Plugin platform tables are not initialized in this environment yet.",
    };
  }

  if (pluginCatalogError) {
    return {
      success: false,
      error: `Failed to validate plugin availability: ${pluginCatalogError.message}`,
    };
  }

  if (pluginCatalog?.visibility === "private") {
    return {
      success: false,
      error:
        "Private plugins are managed by the Let's Assist team. Contact support for changes.",
    };
  }

  const { data: existingInstall, error: existingInstallError } = (await adminSupabase
    .from("organization_plugin_installs")
    .select("organization_id, plugin_key")
    .eq("organization_id", organizationId)
    .eq("plugin_key", pluginKey)
    .maybeSingle()) as {
    data: { organization_id: string; plugin_key: string } | null;
    error: SupabaseLikeError | null;
  };

  if (existingInstallError) {
    return {
      success: false,
      error: `Failed to load current install state: ${existingInstallError.message}`,
    };
  }

  if (!existingInstall) {
    return {
      success: false,
      error: "Plugin is not installed for this organization.",
    };
  }

  const { error: deleteError } = await adminSupabase
    .from("organization_plugin_installs")
    .delete()
    .eq("organization_id", organizationId)
    .eq("plugin_key", pluginKey);

  if (deleteError) {
    return {
      success: false,
      error: `Failed to uninstall plugin: ${deleteError.message}`,
    };
  }

  const { data: organization } = await adminSupabase
    .from("organizations")
    .select("id, username")
    .eq("id", organizationId)
    .maybeSingle();

  if (organization) {
    const organizationSlug = organization.username || organization.id;
    revalidatePath(`/organization/${organizationSlug}`);
    revalidatePath(`/organization/${organizationSlug}/settings`);
  }

  revalidatePath(`/organization/${organizationId}`);
  revalidatePath(`/organization/${organizationId}/settings`);

  return { success: true };
}

export async function updateOrganizationPluginToLatest(options: {
  organizationId: string;
  pluginKey: string;
}): Promise<{ success: boolean; error?: string }> {
  const { organizationId, pluginKey } = options;
  const { user } = await getAuthUser();

  if (!user) {
    return { success: false, error: "You must be logged in to update plugins" };
  }

  const adminSupabase = getAdminClient();

  const isAdmin = await isOrganizationAdminForSettings(organizationId, user.id);
  if (!isAdmin) {
    return { success: false, error: "Only organization admins can update plugins" };
  }

  const { data: pluginCatalog, error: pluginCatalogError } = (await adminSupabase
    .from("plugins")
    .select("key, visibility, is_active, latest_version")
    .eq("key", pluginKey)
    .eq("is_active", true)
    .maybeSingle()) as {
    data: {
      key: string;
      visibility: "global" | "private";
      is_active: boolean;
      latest_version: string;
    } | null;
    error: SupabaseLikeError | null;
  };

  if (pluginCatalogError) {
    return {
      success: false,
      error: `Failed to load plugin catalog entry: ${pluginCatalogError.message}`,
    };
  }

  if (!pluginCatalog) {
    return { success: false, error: "Plugin is not active in catalog." };
  }

  if (pluginCatalog.visibility !== "global") {
    return {
      success: false,
      error:
        "Private plugins are managed by the Let's Assist team. Contact support for changes.",
    };
  }

  const { data: existingInstall, error: existingInstallError } = (await adminSupabase
    .from("organization_plugin_installs")
    .select("id, enabled")
    .eq("organization_id", organizationId)
    .eq("plugin_key", pluginKey)
    .maybeSingle()) as {
    data: { id: string; enabled: boolean } | null;
    error: SupabaseLikeError | null;
  };

  if (existingInstallError) {
    return {
      success: false,
      error: `Failed to load install state: ${existingInstallError.message}`,
    };
  }

  if (!existingInstall) {
    return {
      success: false,
      error: "Plugin must be installed before it can be updated.",
    };
  }

  const { error: updateError } = await adminSupabase
    .from("organization_plugin_installs")
    .update({
      installed_version: pluginCatalog.latest_version,
      enabled: true,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("plugin_key", pluginKey);

  if (updateError) {
    return { success: false, error: `Failed to update plugin: ${updateError.message}` };
  }

  const { data: organization } = await adminSupabase
    .from("organizations")
    .select("id, username")
    .eq("id", organizationId)
    .maybeSingle();

  if (organization) {
    const organizationSlug = organization.username || organization.id;
    revalidatePath(`/organization/${organizationSlug}`);
    revalidatePath(`/organization/${organizationSlug}/settings`);
  }

  revalidatePath(`/organization/${organizationId}`);
  revalidatePath(`/organization/${organizationId}/settings`);

  return { success: true };
}

export async function updateOrganizationPluginConfiguration(options: {
  organizationId: string;
  pluginKey: string;
  configurationJson: string;
}): Promise<{ success: boolean; error?: string; message?: string }> {
  const { organizationId, pluginKey, configurationJson } = options;
  const { user } = await getAuthUser();

  if (!user) {
    return { success: false, error: "You must be logged in to update plugin settings" };
  }

  const adminSupabase = getAdminClient();

  const isAdmin = await isOrganizationAdminForSettings(organizationId, user.id);
  if (!isAdmin) {
    return { success: false, error: "Only organization admins can update plugin settings" };
  }

  const definition = getRegisteredPlugin(pluginKey);
  if (!definition) {
    return {
      success: false,
      error: "This plugin package is not loaded in the current deployment.",
    };
  }

  if (definition.manifest.visibility !== "global") {
    return {
      success: false,
      error:
        "Private plugins are managed by the Let's Assist team. Contact support for changes.",
    };
  }

  const { data: pluginCatalog, error: pluginCatalogError } = (await adminSupabase
    .from("plugins")
    .select("key, visibility, is_active")
    .eq("key", pluginKey)
    .eq("is_active", true)
    .maybeSingle()) as {
    data: { key: string; visibility: "global" | "private"; is_active: boolean } | null;
    error: SupabaseLikeError | null;
  };

  if (pluginCatalogError) {
    return {
      success: false,
      error: `Failed to load plugin catalog entry: ${pluginCatalogError.message}`,
    };
  }

  if (!pluginCatalog) {
    return { success: false, error: "Plugin is not active in catalog." };
  }

  if (pluginCatalog.visibility !== "global") {
    return {
      success: false,
      error:
        "Private plugins are managed by the Let's Assist team. Contact support for changes.",
    };
  }

  const { data: existingInstall, error: existingInstallError } = (await adminSupabase
    .from("organization_plugin_installs")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("plugin_key", pluginKey)
    .maybeSingle()) as {
    data: { id: string } | null;
    error: SupabaseLikeError | null;
  };

  if (existingInstallError) {
    return {
      success: false,
      error: `Failed to load plugin install state: ${existingInstallError.message}`,
    };
  }

  if (!existingInstall) {
    return {
      success: false,
      error: "Install the plugin before updating its settings.",
    };
  }

  const trimmed = configurationJson.trim();

  let parsedConfiguration: Record<string, unknown> = {};
  if (trimmed.length > 0) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!isPlainObjectRecord(parsed)) {
        return {
          success: false,
          error: "Plugin settings must be a JSON object.",
        };
      }

      parsedConfiguration = parsed;
    } catch {
      return {
        success: false,
        error: "Plugin settings JSON is invalid.",
      };
    }
  }

  const schema = definition.manifest.configSchema;
  let normalizedConfiguration = parsedConfiguration;

  if (schema) {
    normalizedConfiguration = applyConfigDefaults(
      parsedConfiguration,
      schema as PluginConfigSchema,
    );

    const validation = validatePluginConfig(
      normalizedConfiguration,
      schema as PluginConfigSchema,
    );

    if (!validation.valid) {
      const firstError = validation.errors[0];
      const fieldPath = firstError?.path && firstError.path !== "/"
        ? firstError.path
        : "root";

      return {
        success: false,
        error: `Settings validation failed at ${fieldPath}: ${firstError?.message || "Invalid value"}`,
      };
    }
  }

  const { error: updateError } = await adminSupabase
    .from("organization_plugin_installs")
    .update({
      configuration: normalizedConfiguration,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("plugin_key", pluginKey);

  if (updateError) {
    return {
      success: false,
      error: `Failed to save plugin settings: ${updateError.message}`,
    };
  }

  const { data: organization } = await adminSupabase
    .from("organizations")
    .select("id, username")
    .eq("id", organizationId)
    .maybeSingle();

  if (organization) {
    const organizationSlug = organization.username || organization.id;
    revalidatePath(`/organization/${organizationSlug}`);
    revalidatePath(`/organization/${organizationSlug}/settings`);
  }

  revalidatePath(`/organization/${organizationId}`);
  revalidatePath(`/organization/${organizationId}/settings`);

  return {
    success: true,
    message: "Plugin settings saved.",
  };
}
