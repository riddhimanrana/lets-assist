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

  // Gate non-trusted users with guidance (allow if TM status already accepted)
  if (!userProfile?.trusted_member) {
    const { data: tmApp } = await supabase
      .from('trusted_member')
      .select('status')
      .eq('id', user.id)
      .maybeSingle();
    const status = tmApp?.status ?? null;
    if (status === true) {
      // Permit access while profile flag syncs
    } else {
      return (
      <div className="container mx-auto p-6 max-w-2xl">
        <h1 className="text-2xl font-bold mb-2">Create Project</h1>
        <p className="text-muted-foreground mb-6">
          Only Trusted Members can create projects.
        </p>
        <div className="rounded-md border p-4 space-y-2">
          {status === false ? (
            <p>
              It looks like you have already applied to be a Trusted Member and were not accepted. If you believe this is an error or have questions, please contact support@lets-assist.com.
            </p>
          ) : (
            <p>
              To request access, please fill out the Trusted Member form. Once your application is accepted, you will be able to create projects.
            </p>
          )}
          <a href="/trusted-member" className="text-primary underline">Go to Trusted Member form</a>
        </div>
      </div>
    );
    }
  }

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
