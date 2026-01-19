import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import DraftsClient from "./DraftsClient";

export const metadata = {
  title: "My Drafts | Let's Assist",
  description: "View and manage your draft volunteering projects",
};

export default async function DraftsPage() {
  const supabase = await createClient();
  
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  
  if (userError || !user) {
    redirect("/login?redirect=/projects/drafts");
  }

  // Fetch user's draft projects
  const { data: drafts, error: draftsError } = await supabase
    .from("projects")
    .select(`
      id,
      title,
      description,
      location,
      event_type,
      schedule,
      cover_image_url,
      created_at,
      workflow_status,
      organization:organizations (
        id,
        name,
        logo_url
      )
    `)
    .eq("creator_id", user.id)
    .eq("workflow_status", "draft")
    .order("created_at", { ascending: false });

  if (draftsError) {
    console.error("Error fetching drafts:", draftsError);
  }

  return <DraftsClient drafts={drafts || []} />;
}
