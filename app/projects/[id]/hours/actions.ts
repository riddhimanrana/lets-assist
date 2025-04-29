"use server";

import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";
import { v4 as uuidv4 } from "uuid";
import { Project } from "@/types"; // Import Project type

// Define the structure for session data passed from the client
type SessionVolunteerData = {
  signupId: string;
  userId: string | null;
  name: string | null;
  email: string | null;
  checkIn: string | null;
  checkOut: string | null;
  durationMinutes: number;
  isValid: boolean;
};

// Helper function to get the key for the 'published' JSONB field
const getPublishStateKey = (project: Project, sessionId: string): string => {
  if (project.event_type === "oneTime") {
    return "oneTime";
  } else if (project.event_type === "multiDay") {
    const [_, dayIndex, __, slotIndex] = sessionId.split("-");
    const dateKey = project.schedule.multiDay?.[parseInt(dayIndex)]?.date;
    return `${dateKey}-${slotIndex}`;
  } else if (project.event_type === "sameDayMultiArea") {
    // For multi-area events, the sessionId is the role name
    return sessionId;
  }
  return sessionId; // Fallback
};


export async function publishVolunteerHours(
  projectId: string,
  sessionId: string,
  sessionData: SessionVolunteerData[]
): Promise<{ success: boolean; error?: string; certificatesCreated?: number }> {
  const cookieStore = cookies();
  const supabase = await createClient();

  try {
    // 1. Verify user authentication and permissions (simplified for brevity)
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return { success: false, error: "Authentication required." };
    }
    // TODO: Add robust permission check (is user the project creator or org admin/staff?)

    // 2. Fetch Project, Organization, and Creator data
    const { data: projectData, error: projectError } = await supabase
      .from("projects")
      .select(`
        *,
        profiles!projects_creator_id_fkey1 (full_name),
        organization:organizations (name, verified) 
      `)
      .eq("id", projectId)
      .single();

    if (projectError || !projectData) {
      console.error("Error fetching project data:", projectError);
      return { success: false, error: "Project not found or error fetching data." };
    }

    // Type assertion after successful fetch
    const project = projectData as Project;
    const creatorName = project.profiles?.full_name || "Project Organizer"; // Fallback name
    const organizationName = project.organization?.name || null;
    const isOrganizationVerified = project.organization?.verified || false;

    // 3. Filter out invalid entries (though client should prevent this)
    const validVolunteers = sessionData.filter(v => v.isValid && v.checkIn && v.checkOut);
    if (validVolunteers.length === 0) {
      return { success: false, error: "No valid volunteer hours data to publish." };
    }

    // 4. Prepare certificate data
    const certificatesToInsert = validVolunteers.map(volunteer => ({
      project_id: projectId, // check
      user_id: volunteer.userId, // Can be null for anonymous // check
      signup_id: volunteer.signupId,
      volunteer_name: volunteer.name || "No Name Volunteer", // Use provided name or fallback // check
      volunteer_email: volunteer.email, // Can be null // check
      project_title: project.title, // check
      project_location: project.location, // check
      event_start: volunteer.checkIn,
      event_end: volunteer.checkOut,
      //   issued_at: new Date().toISOString(), //handled by database trigger
      organization_name: organizationName, // Use fetched org name
      creator_name: creatorName, // Use fetched creator name
      is_certified: isOrganizationVerified, // Use org verified status
      // --- END UPDATED FIELDS ---
      check_in_method: project.verification_method,
      schedule_id: sessionId, // Store the session identifier, sessionId renamed to scheduleId
    }));

    // 5. Insert certificates into the database
    const { error: insertError } = await supabase
      .from("certificates")
      .insert(certificatesToInsert);

    if (insertError) {
        console.log(certificatesToInsert)
      console.error("Error inserting certificates:", insertError);
      return { success: false, error: `Database error inserting certificates: ${insertError.message}` };
    }

    // 6. Update the project's 'published' status
    const publishKey = getPublishStateKey(project, sessionId);
    const currentPublishedState = (project.published || {}) as Record<string, boolean>;
    const updatedPublishedState = {
      ...currentPublishedState,
      [publishKey]: true,
    };

    const { error: updateProjectError } = await supabase
      .from("projects")
      .update({ published: updatedPublishedState })
      .eq("id", projectId);

    if (updateProjectError) {
      console.error("Error updating project published status:", updateProjectError);
      // Even if this fails, certificates were created, so maybe return success but log error?
      // For now, let's return an error to be safe.
      return { success: false, error: `Failed to update project status: ${updateProjectError.message}` };
    }


    console.log(`Successfully created ${certificatesToInsert.length} certificates for project ${projectId}, session ${sessionId}`);
    return { success: true, certificatesCreated: certificatesToInsert.length };

  } catch (error: any) {
    console.error("Unexpected error in publishVolunteerHours:", error);
    return { success: false, error: error.message || "An unexpected server error occurred." };
  }
}
