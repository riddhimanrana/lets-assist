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

  // Get user profile information including trusted member status
  const { data: userProfile } = await supabase
    .from('profiles')
    .select('profile_image_url, trusted_member')
    .eq('id', user.id)
    .single();

  // Check if user is a trusted member
  if (!userProfile?.trusted_member) {
    return (
      <div className="container mx-auto px-4 sm:px-8 lg:px-12 py-8 max-w-2xl text-center space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-4">Trusted Member Required</h1>
          <p className="text-lg text-muted-foreground mb-6">
            Only trusted members can create projects and organizations on Let&apos;s Assist.
          </p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <div className="flex items-start gap-3">
            <div className="text-blue-600">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="text-left">
              <h3 className="font-medium text-blue-900 mb-2">How to become a trusted member</h3>
              <p className="text-sm text-blue-800 mb-4">
                Trusted members are verified users who help maintain the quality and safety of volunteer opportunities on our platform.
              </p>
              <a 
                href="/trusted-member"
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium"
              >
                Apply for Trusted Member Status
              </a>
            </div>
          </div>
        </div>
      </div>
    );
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
