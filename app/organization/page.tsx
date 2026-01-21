import { createClient } from "@/utils/supabase/server";
import { Metadata } from "next";
import OrganizationsDisplay from "./OrganizationsDisplay";
import type { Organization } from "@/types";

type OrganizationRow = Organization & {
  description?: string | null;
  website?: string | null;
  logo_url?: string | null;
  created_at?: string | null;
};

type UserMembership = {
  role: "admin" | "staff" | "member";
  organization_id: string;
  organizations?: OrganizationRow | null;
};

type MemberCountRow = {
  organization_id: string;
};

export const metadata: Metadata = {
  title: "Organizations",
  description: "Explore and join organizations",
};

export default async function OrganizationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
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
  
  // Fetch all organizations
  const { data: organizations } = (await supabase
    .from("organizations")
    .select(`
      id,
      name,
      username,
      description,
      website,
      logo_url,
      type,
      verified,
      created_at
    `)
    .order('verified', { ascending: false })
    .order('created_at', { ascending: false })) as {
    data: OrganizationRow[] | null;
    error: { message: string } | null;
  };

  // Get member counts for all organizations
  const { data: memberCounts } = (await supabase
    .from("organization_members")
    .select('organization_id', { count: 'exact', head: false })) as {
    data: MemberCountRow[] | null;
    error: { message: string } | null;
  };

  // Create member counts map
  const orgMemberCounts = (memberCounts || []).reduce((acc, item) => {
    acc[item.organization_id] = (acc[item.organization_id] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // If user is logged in, fetch their organization memberships
  let userMemberships: UserMembership[] = [];
  if (isLoggedIn && user) {
    const { data: memberships } = (await supabase
      .from('organization_members')
      .select(`
        role,
        organization_id,
        organizations (
          id,
          name,
          username,
          description,
          website,
          logo_url,
          type,
          verified,
          created_at
        )
      `)
      .eq('user_id', user.id)
      .order('role', { ascending: false })) as {
      data: UserMembership[] | null;
      error: { message: string } | null;
    }; // Admin first, then staff, then member

    userMemberships = (memberships || []).map((membership) => ({
      ...membership,
      organizations: Array.isArray(membership.organizations)
        ? membership.organizations[0]
        : membership.organizations,
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
    />
  );
}
