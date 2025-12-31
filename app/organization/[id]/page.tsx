import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { Metadata } from "next";
import OrganizationHeader from "./OrganizationHeader";
import OrganizationTabs from "./OrganizationTabs";
import { Separator } from "@/components/ui/separator";
import {
  getAdminDashboardMetrics,
  getTopVolunteers,
  getOrgProjectsWithStats,
} from "./admin/actions";

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  
  // Try to fetch by username first
  const { data: orgByUsername } = await supabase
    .from("organizations")
    .select("name, description")
    .eq("username", id)
    .single();

  // If not found by username, try by ID
  const { data: orgById } = !orgByUsername 
    ? await supabase
      .from("organizations")
      .select("name, description")
      .eq("id", id)
      .single()
    : { data: null };
  
  const org = orgByUsername || orgById;
  
  if (!org) {
    return {
      title: "Organization Not Found",
      description: "The requested organization could not be found.",
    };
  }
  
  return {
    title: org.name,
    description: org.description || `${org.name} organization page`,
  };
}

export default async function OrganizationPage({ params }: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  // Check if ID is a username or UUID
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  
  // Try to fetch organization by username or ID depending on the format
  const { data: organization } = isUUID
    ? await supabase
        .from("organizations")
        .select("*, created_by, organization_members(user_id, role)")
        .eq("id", id)
        .single()
    : await supabase
        .from("organizations")
        .select("*, created_by, organization_members(user_id, role)")
        .eq("username", id)
        .single();
  
  if (!organization) {
    notFound();
  }

  // If accessed by ID but has username, redirect to the username URL for better SEO
  if (isUUID && organization.username) {
    redirect(`/organization/${organization.username}`);
  }
  
  // Determine the user's role in this organization
  let userRole = null;
  if (user) {
    const memberRecord = organization.organization_members.find(
      (member: any) => member.user_id === user.id
    );
    userRole = memberRecord?.role || null;
  }

  console.log("Fetching members for organization ID:", organization.id);
  
  // FIXED: First fetch members from organization_members table
  const { data: membersData, error: membersError } = await supabase
    .from("organization_members")
    .select(`
      id, 
      role, 
      joined_at,
      user_id,
      organization_id
    `)
    .eq("organization_id", organization.id)
    .order("role", { ascending: false });
  
  if (membersError) {
    console.error("Error fetching organization members:", membersError);
  }
  
  // Get the list of user IDs
  const userIds = membersData?.map(member => member.user_id) || [];
  
  // No need to query profiles if there are no members
  let profilesData: any[] = [];
  if (userIds.length > 0) {
    // Then fetch profile data for those users
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, username, full_name, avatar_url")
      .in("id", userIds);
      
    if (profilesError) {
      console.error("Error fetching member profiles:", profilesError);
    } else {
      profilesData = profiles || [];
    }
  }
  
  // Combine the data
  const formattedMembers = membersData?.map(member => {
    const profile = profilesData.find(p => p.id === member.user_id) || null;
    return {
      ...member,
      profiles: profile
    };
  }) || [];
  
  console.log("Members query result:", formattedMembers.length, "members found");

  // Get organization projects
  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false });

  // Fetch dashboard data if user is admin only
  let dashboardData = undefined;
  if (userRole === "admin") {
    const [metrics, topVolunteers, projectsWithStats] = await Promise.all([
      getAdminDashboardMetrics(organization.id),
      getTopVolunteers(organization.id),
      getOrgProjectsWithStats(organization.id),
    ]);
    
    dashboardData = {
      metrics,
      topVolunteers,
      projectsWithStats,
    };
  }
  
  return (
    <div className="flex flex-col w-full">
      <div className="w-full absolute bg-gradient-to-br from-primary/15 via-primary/5 to-background/0 min-h-72 before:content-[''] before:absolute before:inset-0 before:bg-gradient-to-b before:from-transparent before:to-background"/>
      
      <div className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 pt-6 sm:pt-10">
      <OrganizationHeader 
        organization={organization} 
        userRole={userRole}
        memberCount={formattedMembers?.length || 0}
      />
      
      <div className="mt-8 sm:mt-12 bg-card rounded-xl border border-border/60 shadow-sm p-4 sm:p-6 mb-8 min-h-[520px]">
        <OrganizationTabs 
        organization={organization}
        members={formattedMembers}
        projects={projects || []}
        userRole={userRole}
        currentUserId={user?.id}
        dashboardData={dashboardData}
        />
      </div>
      </div>
    </div>
  );
}
