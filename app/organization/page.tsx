import { createClient } from "@/utils/supabase/server";
import { Metadata } from "next";
import OrganizationsDisplay from "./OrganizationsDisplay";

export const metadata: Metadata = {
  title: "Organizations",
  description: "Explore and join organizations",
};

export default async function OrganizationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isLoggedIn = !!user;
  
  // Fetch organizations with ordering by verified status first
  const { data: organizations } = await supabase
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
      created_at,
      organization_members!inner(user_id)
    `)
    .order('verified', { ascending: false })
    .order('created_at', { ascending: false });

  // Get member counts
  const { data: memberCounts } = await supabase
    .from("organization_members")
    .select('organization_id', { count: 'exact', head: false });

  // Create member counts map
  const orgMemberCounts = (memberCounts || []).reduce((acc, item) => {
    acc[item.organization_id] = (acc[item.organization_id] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <OrganizationsDisplay
      organizations={organizations || []}
      memberCounts={orgMemberCounts}
      isLoggedIn={isLoggedIn}
    />
  );
}
