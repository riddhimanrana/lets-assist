import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";
import { getProject, getCreatorProfile } from "./actions";
import { redirect, notFound } from "next/navigation";
import ProjectDetails from "./ProjectDetails";
import { getSlotCapacities } from "./utils";
import { getProjectStatus } from "@/utils/project";
import ProjectUnauthorized from "./ProjectUnauthorized";
import { Project } from "@/types"; // Assuming Project type is imported

// Define the props type for the page component
interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function ProjectPage({ params }: PageProps): Promise<React.ReactElement> {
  const supabase = await createClient();

  // Destructure id from params
  const { id } = await params;

  // Get the project data
  const { project, error: projectError } = await getProject(id);

  // Handle unauthorized access to private projects
  if (projectError === "unauthorized") {
    return <ProjectUnauthorized projectId={id} />;
  }

  // Handle project not found
  if (projectError || !project) {
    notFound();
  }

  const { profile: creator, error: profileError } = await getCreatorProfile(project.creator_id);
  if (profileError) {
    console.error("Error fetching creator profile:", profileError);
  }
  if (!creator) {
    notFound();
  }

  // Check if current user is the project creator
  const { data: { user } } = await supabase.auth.getUser();
  const isCreator = user?.id === project.creator_id;

  // Get organization if exists
  let organization = null;
  if (project.organization_id) {
    const { data: org } = await supabase
      .from("organizations")
      .select("*")
      .eq("id", project.organization_id)
      .single();
    organization = org;
  }

  // Get remaining slots for each schedule
  // Pass supabase client and project id to the updated function
  const slotCapacities = await getSlotCapacities(project, supabase, id);

  // Get user's existing signups
  const userSignups: Record<string, boolean> = {};
  if (user) {
    const { data: signups } = await supabase
      .from("project_signups")
      .select("schedule_id")
      .eq("project_id", project.id)
      .eq("user_id", user.id)
      .eq("status", "approved");

    if (signups) {
      signups.forEach((signup: { schedule_id: string }) => {
        userSignups[signup.schedule_id] = true;
      });
    }
  }

  // Get user's rejected slots
  const rejectedSlots: Record<string, boolean> = {};
  if (user) {
    const { data: rejections } = await supabase
      .from("project_signups")
      .select("schedule_id")
      .eq("project_id", project.id)
      .eq("user_id", user.id)
      .eq("status", "rejected");

    if (rejections) {
      rejections.forEach((rejection: { schedule_id: string }) => {
        rejectedSlots[rejection.schedule_id] = true;
      });
    }
  }

  // Format initial data for the client component
  const initialSlotData = {
    remainingSlots: slotCapacities,
    userSignups: userSignups,
    rejectedSlots: rejectedSlots,  // Include rejected slots in initial data
  };

  return (
    <ProjectDetails
      project={project}
      creator={creator}
      organization={organization}
      initialSlotData={initialSlotData}
      initialIsCreator={isCreator}
      initialUser={user}
    />
  );
}
