import { Metadata } from "next";
import ProjectCreator from "./ProjectCreator";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { EventFormState } from "@/hooks/use-event-form";
import { headers } from "next/headers";

// Define a type for the combobox options
interface OrganizationOption {
  id: string;
  name: string;
  logo_url?: string | null;
  role: string;
  allowed_email_domains?: string[] | null;
}

type MembershipRow = {
  organization_id: string;
  role: string;
  organizations?:
    | {
        name: string;
        logo_url?: string | null;
        allowed_email_domains?: string[] | null;
      }
    | {
        name: string;
        logo_url?: string | null;
        allowed_email_domains?: string[] | null;
      }[]
    | null;
};

type DraftRow = {
  id: string;
  title: string | null;
  draft_data: Partial<EventFormState> | null;
  created_at: string;
};
 
export const metadata: Metadata = {
  title: "Create Project",
  description: "Start a new volunteering project on Let's Assist and connect with volunteers to make a difference in your community.",
};

export default async function CreateProjectPage({
  searchParams
}: {
  searchParams: Promise<{ org?: string; draft?: string }>
}) {
  // Defensive: if this route is accidentally served on the Supabase API custom domain,
  // redirect back to the primary site domain where Next routes are hosted.
  const host = (await headers()).get("host") || "";
  if (host === "api.lets-assist.com" || host.endsWith(".api.lets-assist.com")) {
    return redirect("https://lets-assist.com/projects/create");
  }

  if (process.env.E2E_TEST_MODE === "true") {
    const date = new Date();
    date.setDate(date.getDate() + 2);
    const dateStr = date.toISOString().slice(0, 10);

    return (
      <div className="w-full mx-auto p-4 sm:p-8 max-w-3xl space-y-4" data-testid="e2e-project-mock">
        <h1 className="text-2xl font-bold">Create Project</h1>
        <p className="text-muted-foreground">
          E2E mode: project creation is mocked to avoid external dependencies.
        </p>
        <div className="space-y-3">
          <label className="space-y-1 block">
            <span className="font-medium">Project Title</span>
            <input
              data-testid="e2e-project-title"
              defaultValue="E2E Project"
              className="w-full rounded-md border px-3 py-2"
            />
          </label>
          <label className="space-y-1 block">
            <span className="font-medium">Project Location</span>
            <input
              data-testid="e2e-project-location"
              defaultValue="Test Location"
              className="w-full rounded-md border px-3 py-2"
            />
          </label>
          <label className="space-y-1 block">
            <span className="font-medium">Event Date</span>
            <input
              data-testid="e2e-project-date"
              type="date"
              defaultValue={dateStr}
              className="w-full rounded-md border px-3 py-2"
            />
          </label>
        </div>
        <div className="rounded-md border bg-muted/30 p-4" data-testid="e2e-project-confirm">
          Mock project ready to submit.
        </div>
      </div>
    );
  }

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

  // Public visibility requires trusted status. Accept either profile sync flag
  // or approved trusted_member application row.
  const { data: tmApp } = await supabase
    .from('trusted_member')
    .select('status')
    .or(`id.eq.${user.id},user_id.eq.${user.id}`)
    .maybeSingle();

  const canUsePublicVisibility =
    userProfile?.trusted_member === true || tmApp?.status === true;

  // Get organization ID from URL params if provided - fixed approach
  const search = await searchParams;
  const orgIdFromUrl = search?.org || undefined;
  const draftIdFromUrl = search?.draft || undefined;

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
    .select('organization_id, role, organizations(id, name, logo_url, allowed_email_domains)')
    .eq('user_id', user.id)
    .in('role', ['admin', 'staff']);

  if (memberships && memberships.length > 0) {
    const orgs: OrganizationOption[] = (memberships as MembershipRow[]).map((m) => {
      const organization = Array.isArray(m.organizations)
        ? m.organizations[0]
        : m.organizations;

      return {
        id: m.organization_id,
        name: organization?.name ?? "Organization",
        logo_url: organization?.logo_url ?? null,
        allowed_email_domains: organization?.allowed_email_domains ?? null,
        role: m.role,
      };
    });
    orgOptions = [orgOptions[0], ...orgs];
  }

  // Fetch user's drafts from project_drafts table
  const { data: drafts } = await supabase
    .from('project_drafts')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  // Load specific draft if requested, otherwise load most recent autosaved draft
  let loadedDraft: Partial<EventFormState> | null = null;
  let loadedDraftId: string | null = null;
  if (draftIdFromUrl) {
    const { data: draft } = await supabase
      .from('project_drafts')
      .select('*')
      .eq('id', draftIdFromUrl)
      .eq('user_id', user.id)
      .single();
    
    if (draft) {
      loadedDraft = draft.draft_data;
      loadedDraftId = draft.id;
    }
  } else if (drafts && drafts.length > 0) {
    // Load the most recently updated draft (autosaved)
    loadedDraft = drafts[0].draft_data;
    loadedDraftId = drafts[0].id;
  }

  return (
    <div className="w-full mx-auto p-4 sm:p-8 max-w-4xl">
      <ProjectCreator 
        initialOrgId={initialOrgId} 
        initialOrgOptions={orgOptions}
        canUsePublicVisibility={canUsePublicVisibility}
        initialDraftData={loadedDraft ?? undefined}
        initialDraftId={loadedDraftId}
        drafts={(drafts as DraftRow[] | null)?.map((d) => ({
          id: d.id,
          title: d.title || 'Untitled Draft',
          description: d.draft_data?.basicInfo?.description || '',
          location: d.draft_data?.basicInfo?.location || '',
          event_type: d.draft_data?.eventType || 'oneTime',
          schedule: d.draft_data?.schedule || null,
          cover_image_url: null,
          created_at: d.created_at,
          workflow_status: 'draft',
          organization: null
        })) || []}
      />
    </div>
  );
}
