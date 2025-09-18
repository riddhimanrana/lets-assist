import { Metadata } from "next";
import ProjectCreator from "./ProjectCreator";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";

// Define a type for the combobox options
interface OrganizationOption {
  id: string;
  name: string;
  logo_url?: string | null;
  role: string;
}

export const metadata: Metadata = {
  title: "Create Project",
  description: "Start a new volunteering project on Let's Assist and connect with volunteers to make a difference in your community.",
};

export default async function CreateProjectPage({ 
  searchParams 
}: { 
  searchParams: Promise<{ org?: string }> 
}) {
  const supabase = await createClient();
  
  // Authentication check on the server
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return redirect("/login?redirect=/projects/create");
  }

  // Get user profile information including profile picture
  const { data: userProfile } = await supabase
    .from('profiles')
    .select('profile_image_url, trusted_member')
    .eq('id', user.id)
    .single();

  // Get organization ID from URL params if provided - fixed approach
  const search = await searchParams;
  const orgIdFromUrl = search?.org || undefined;
  
  // If org ID is provided, verify permission and assign initialOrgId
  let initialOrgId = undefined;
  
  if (orgIdFromUrl) {
    const { data: permission } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', orgIdFromUrl)
      .eq('user_id', user.id)
      .single();
    
    if (permission?.role === 'admin' || permission?.role === 'staff') {
      initialOrgId = orgIdFromUrl;
    }
  }

  // Preload user organizations to pass to the client
  let orgOptions: OrganizationOption[] = [{
      id: "personal",
      name: "Personal Project",
      logo_url: userProfile?.profile_image_url || null,
      role: "creator"
  }];
  
  const { data: memberships } = await supabase
        .from('organization_members')
        .select('organization_id, role, organizations(id, name, logo_url)')
        .eq('user_id', user.id)
        .in('role', ['admin','staff']);
  
  if (memberships && memberships.length > 0) {
    const orgs: OrganizationOption[] = memberships.map((m: any) => ({
      id: m.organization_id,
      name: Array.isArray(m.organizations) ? m.organizations[0].name : m.organizations?.name,
      logo_url: Array.isArray(m.organizations) ? m.organizations[0].logo_url : m.organizations?.logo_url,
      role: m.role
    }));
    orgOptions = [orgOptions[0], ...orgs];
  }
  
  return (
    <div className="container mx-auto p-4 sm:p-8 max-w-3xl">
      <ProjectCreator initialOrgId={initialOrgId} initialOrgOptions={orgOptions} />
    </div>
  );
}
