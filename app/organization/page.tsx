import { createClient } from "@/lib/supabase/server";
import { Metadata } from "next";
import OrganizationsDisplay from "./OrganizationsDisplay";
import type { Organization } from "@/types";
import {
  createRemoteReadonlyClient,
  getRemoteUserIdForLocalUser,
} from "@/lib/supabase/preview-source";
import { getServerPreviewSource } from "@/lib/supabase/preview-source.server";

type OrganizationRow = Organization & {
  description?: string | null;
  website?: string | null;
  logo_url?: string | null;
  created_at?: string | null;
  public_member_count?: number | null;
};

type UserMembership = {
  role: "admin" | "staff" | "member";
  organization_id: string;
  organizations?: OrganizationRow | null;
};

export const metadata: Metadata = {
  title: "Organizations",
  description: "Explore and join organizations",
};

export default async function OrganizationsPage() {
  const supabase = await createClient();
  const previewSource = await getServerPreviewSource();
  const remoteReadonly =
    previewSource === "remote" ? createRemoteReadonlyClient() : null;
  const wantsRemotePreview = previewSource === "remote";
  const usingRemotePreview = wantsRemotePreview && Boolean(remoteReadonly);
   const readClient = usingRemotePreview && remoteReadonly ? remoteReadonly : supabase;
  const { data: { user } } = await supabase.auth.getUser();
  const previewWarning =
    wantsRemotePreview && !usingRemotePreview
      ? "Remote preview requested, but remote Supabase keys are missing or invalid. Falling back to local data."
      : null;
  const sourceBadge = usingRemotePreview ? "remote-preview" : "local-only";
  const isLoggedIn = !!user;
  let isTrusted = false;
  let applicationStatus: boolean | null | undefined = undefined;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("trusted_member")
      .eq("id", user.id)
      .single();
    isTrusted = !!profile?.trusted_member;

    const { data: tmApp } = await supabase
      .from("trusted_member")
      .select("status")
      .eq("id", user.id)
      .maybeSingle();
    applicationStatus = tmApp?.status ?? null;
    if (!isTrusted && tmApp?.status === true) {
      isTrusted = true;
    }
  }
  
  // Fetch all organizations through the public-safe read model. The base
  // organizations table contains join codes, staff tokens, and domain settings.
  const { data: organizations } = (await readClient
    .from("organization_public_read_model")
    .select(`
      id,
      name,
      username,
      description,
      website,
      logo_url,
      type,
      verified,
      created_at,
      public_member_count
    `)
    .order('verified', { ascending: false })
    .order('created_at', { ascending: false })) as {
    data: OrganizationRow[] | null;
    error: { message: string } | null;
  };

  const orgMemberCounts = (organizations || []).reduce((acc, organization) => {
    acc[organization.id] = organization.public_member_count ?? 0;
    return acc;
  }, {} as Record<string, number>);

  // If user is logged in, fetch their organization memberships
  let userMemberships: UserMembership[] = [];
  if (isLoggedIn && user) {
    const effectiveUserId =
      usingRemotePreview
        ? getRemoteUserIdForLocalUser(user.email) || user.id
        : user.id;
    const { data: memberships } = (await readClient
      .from('organization_members')
      .select(`
        role,
        organization_id
      `)
      .eq('user_id', effectiveUserId)
      .order('role', { ascending: false })) as {
      data: Array<Omit<UserMembership, "organizations">> | null;
      error: { message: string } | null;
    }; // Admin first, then staff, then member

    const organizationIds = (memberships || []).map((membership) => membership.organization_id);
    let membershipOrganizations: OrganizationRow[] = [];
    if (organizationIds.length > 0) {
      const { data } = (await readClient
        .from("organization_public_read_model")
        .select(`
          id,
          name,
          username,
          description,
          website,
          logo_url,
          type,
          verified,
          created_at,
          public_member_count
        `)
        .in("id", organizationIds)) as {
        data: OrganizationRow[] | null;
        error: { message: string } | null;
      };
      membershipOrganizations = data || [];
    }

    const organizationById = new Map(
      membershipOrganizations.map((organization) => [organization.id, organization]),
    );

    userMemberships = (memberships || []).map((membership) => ({
      ...membership,
      organizations: organizationById.get(membership.organization_id) ?? null,
    }));
  }

  return (
    <OrganizationsDisplay
      organizations={organizations || []}
      memberCounts={orgMemberCounts}
      isLoggedIn={isLoggedIn}
      userMemberships={userMemberships}
      isTrusted={isTrusted}
      applicationStatus={applicationStatus}
      sourceBadge={sourceBadge}
      previewWarning={previewWarning}
    />
  );
}
