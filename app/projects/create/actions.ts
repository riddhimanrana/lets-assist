"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";
// import { redirect } from 'next/navigation'

export async function createProject(formData: FormData) {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "You must be logged in to create a project" };
  }

  // Parse the form data
  const projectData = JSON.parse(formData.get("projectData") as string);

  // Insert into Supabase
  const { data, error } = await supabase
    .from("projects")
    .insert({
      creator_id: user.id,
      title: projectData.basicInfo.title,
      location: projectData.basicInfo.location,
      description: projectData.basicInfo.description,
      event_type: projectData.eventType,
      verification_method: projectData.verificationMethod,
      require_login: projectData.requireLogin,
      schedule: {
        [projectData.eventType]: projectData.schedule[projectData.eventType],
      },
      status: "active",
    })
    .select("id")
    .single();

  if (error) {
    console.error("Error creating project:", error);
    return { error: "Failed to create project. Please try again." };
  }

  // Revalidate projects list page
  revalidatePath("/projects");

  // Return success with the new project ID
  return { success: true, id: data.id };
}
