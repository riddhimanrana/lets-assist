"use server";

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { checkSuperAdmin } from "./auth";
import { createServerNotification } from "./shared";

export async function getOrganizationsForAdmin() {
  "use server";
  const supabase = getAdminClient();

  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    redirect("/not-found");
  }

  const { data, error } = await supabase
    .from("organizations")
    .select(
      "id, name, username, type, verified, created_at, logo_url, created_by",
    )
    .order("verified", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching organizations for admin:", error);
    return { error: "Failed to fetch organizations" };
  }

  return { data: data ?? [] };
}

export async function updateOrganizationVerifiedStatus(
  organizationId: string,
  verified: boolean,
) {
  "use server";
  const supabaseUser = await createClient();
  const {
    data: { user },
  } = await supabaseUser.auth.getUser();

  if (!user) {
    return { error: "Unauthorized" };
  }

  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized" };
  }

  const service = getAdminClient();

  const { data: organization, error: fetchError } = await service
    .from("organizations")
    .select("id, name, username, created_by")
    .eq("id", organizationId)
    .maybeSingle();

  if (fetchError) {
    console.error(
      "Error fetching organization before verification update:",
      fetchError,
    );
    return { error: "Failed to load organization" };
  }

  if (!organization) {
    return { error: "Organization not found" };
  }

  const { error } = await service
    .from("organizations")
    .update({ verified })
    .eq("id", organizationId);

  if (error) {
    console.error("Error updating organization verification status:", error);
    return { error: "Failed to update verification status" };
  }

  if (organization.created_by) {
    await createServerNotification(
      organization.created_by,
      verified ? "Organization verified" : "Organization verification removed",
      verified
        ? `Your organization "${organization.name}" is now verified.`
        : `Verification for your organization "${organization.name}" has been removed.`,
      verified ? "success" : "warning",
      `/organization/${organization.username || organizationId}`,
    );
  }

  return { success: true };
}
