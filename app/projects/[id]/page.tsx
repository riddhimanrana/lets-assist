import { notFound, redirect } from "next/navigation";
import { getProject, getCreatorProfile } from "./actions";
import ProjectDetails from "./ProjectDetails";
import ProjectUnauthorized from "./ProjectUnauthorized";
import { Metadata } from "next";
import { createClient } from "@/utils/supabase/server";
import { getSlotCapacities } from "./utils";

interface SlotData {
  remainingSlots: Record<string, number>;
  userSignups: Record<string, boolean>;
}

interface ProjectSignup {
  schedule_id: string;
  user_id: string;
}

interface PageProps {
  params: Promise<{ id: string }>;
}

async function getSlotData(projectId: string): Promise<SlotData> {
  const supabase = await createClient();
  
  // Get current user
  const { data: { user } } = await supabase.auth.getUser();
  
  // Get project signups
  const { data: signups } = await supabase
    .from("project_signups")
    .select("schedule_id, user_id")
    .eq("project_id", projectId)
    .eq("status", "confirmed") as { data: ProjectSignup[] | null };
  
  // Get project to calculate capacities
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();
  
  if (!project) {
    return { remainingSlots: {}, userSignups: {} };
  }
  
  const slotCapacities = getSlotCapacities(project);
  const slotCounts: Record<string, number> = {};
  const userSignups: Record<string, boolean> = {};
  
  if (signups) {
    signups.forEach((signup: ProjectSignup) => {
      if (!slotCounts[signup.schedule_id]) {
        slotCounts[signup.schedule_id] = 0;
      }
      slotCounts[signup.schedule_id]++;
      
      if (user && signup.user_id === user.id) {
        userSignups[signup.schedule_id] = true;
      }
    });
  }
  
  // Calculate remaining slots
  const remainingSlots: Record<string, number> = {};
  Object.keys(slotCapacities).forEach((scheduleId) => {
    remainingSlots[scheduleId] = slotCapacities[scheduleId] - (slotCounts[scheduleId] || 0);
  });
  
  return { remainingSlots, userSignups };
}

export async function generateMetadata(
  { params }: PageProps,
): Promise<Metadata> {
  const { id } = await params;
  const { project, error } = await getProject(id);

  if (error || !project) {
    return {
      title: "Project Not Found - Let's Assist",
      description: "Project details not available.",
    };
  }

  return {
    title: `${project.title} - Let's Assist`,
    description: project.description,
  };
}

export default async function ProjectPage(
  { params }: PageProps,
): Promise<React.ReactElement> {
  const { id } = await params;
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

  // Get slot data
  const slotData = await getSlotData(id);
  const supabaseClient = await createClient();
  const { data: { user } } = await supabaseClient.auth.getUser();
  const initialIsCreator = !!user && project.creator_id === user.id;
  
  return <ProjectDetails 
    project={project} 
    creator={creator || null} 
    initialSlotData={slotData}
    initialIsCreator={initialIsCreator}
    initialUser={user}
  />;
}
