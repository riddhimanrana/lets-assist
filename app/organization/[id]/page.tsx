import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { Metadata } from "next";
import OrganizationHeader from "./OrganizationHeader";
import OrganizationTabs from "./OrganizationTabs";
import { Separator } from "@/components/ui/separator";

type Props = {
  params: { id: string };
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

  // Get all organization members with their profiles
  const { data: members } = await supabase
    .from("organization_members")
    .select(`
      id, 
      role, 
      joined_at,
      user_id,
      profiles:user_id (
        username,
        full_name,
        avatar_url
      )
    `)
    .eq("organization_id", organization.id)
    .order("role", { ascending: false });

  // Get organization projects
  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false });
  
  return (
    <div className="flex justify-center w-full">
      <div className="container max-w-6xl py-4 sm:py-8 px-4 sm:px-6">
        <OrganizationHeader 
          organization={organization} 
          userRole={userRole}
          memberCount={members?.length || 0}
        />
        
        <Separator className="my-6" />
        
        <OrganizationTabs 
          organization={organization}
          members={members || []}
          projects={projects || []}
          userRole={userRole}
          currentUserId={user?.id}
        />
      </div>
    </div>
  );
}
