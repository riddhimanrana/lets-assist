import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import DraftsClient from "./DraftsClient";
import type { ProjectSchedule, EventType } from "@/types";

export const metadata = {
  title: "My Drafts | Let's Assist",
  description: "View and manage your draft volunteering projects",
};

interface Draft {
  id: string;
  title: string;
  description: string;
  location: string;
  event_type: EventType;
  schedule: ProjectSchedule | null;
  cover_image_url: string | null;
  created_at: string;
  workflow_status: string;
  organization: {
    id: string;
    name: string;
    logo_url: string | null;
  } | null;
}

export default async function DraftsPage() {
  const supabase = await createClient();
  
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  
  if (userError || !user) {
    redirect("/login?redirect=/projects/drafts");
  }

  // Fetch user's draft projects from project_drafts table
  const { data: projectDrafts, error: draftsError } = await supabase
    .from("project_drafts")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (draftsError) {
    console.error("Error fetching drafts:", draftsError);
  }

  // Transform project_drafts to match the Draft interface
  const drafts: Draft[] = (projectDrafts || []).map((draft: any) => ({
    id: draft.id,
    title: draft.draft_data?.basicInfo?.title || draft.title || "Untitled",
    description: draft.draft_data?.basicInfo?.description || "",
    location: draft.draft_data?.basicInfo?.location || "",
    event_type: draft.draft_data?.eventType || "oneTime",
    schedule: draft.draft_data?.schedule || null,
    cover_image_url: draft.draft_data?.coverImageUrl || null,
    created_at: draft.created_at,
    workflow_status: "draft",
    organization: draft.draft_data?.basicInfo?.organizationId 
      ? { id: draft.draft_data.basicInfo.organizationId, name: "", logo_url: null }
      : null,
  }));

  return <DraftsClient drafts={drafts} />;
}
