import { createClient } from "@/utils/supabase/server";
import { notFound } from "next/navigation";
import { Project } from "@/types";
import AnonymousSignupClient from "./AnonymousSignupClient";

interface PageProps {
  params: Promise<{ id: string}>
}

export default async function AnonymousSignupPage({ params }: PageProps): Promise<React.ReactElement> {
  // First, access the ID from params
  const param = await params;
  const signupId = param.id;
  
  // Exit early if ID is missing
  if (!signupId) {
    notFound();
  }
  
  const supabase = await createClient();

  // Fetch anonymous signup with explicit foreign key relationship
  const { data: signupData, error } = await supabase
    .from("anonymous_signups")
    .select(`
      *,
      project_signup:project_signups!project_signups_anonymous_id_fkey(
        id,
        status,
        schedule_id,
        project:projects(*)
      )
    `)
    .eq("id", signupId)
    .maybeSingle();

  if (error || !signupData) {
    console.error("Error fetching anonymous signup:", error);
    notFound();
  }

  // Handle array result from joined data
  let projectSignup;
  let project;

  if (Array.isArray(signupData.project_signup)) {
    // Handle array response
    if (signupData.project_signup.length === 0) {
      console.error("No linked project signup found");
      notFound();
    }
    projectSignup = signupData.project_signup[0];
  } else {
    // Handle single object response
    projectSignup = signupData.project_signup;
  }

  if (!projectSignup) {
    console.error("Missing project signup data");
    notFound();
  }

  // Extract project data, which might be nested as array or object
  if (Array.isArray(projectSignup.project)) {
    project = projectSignup.project[0];
  } else {
    project = projectSignup.project;
  }

  if (!project) {
    console.error("Missing project data");
    notFound();
  }

  // Check if the project is cancelled
  const isProjectCancelled = project.status === 'cancelled';

  const { name, email, phone_number, confirmed_at, created_at } = signupData;
  const { status, schedule_id, id: project_signup_id } = projectSignup;

  // Pass all the necessary data to the client component, including IDs needed for deletion
  return (
    <AnonymousSignupClient
      id={signupId}
      name={name}
      email={email}
      phone_number={phone_number}
      confirmed_at={confirmed_at}
      created_at={created_at}
      status={status}
      schedule_id={schedule_id}
      project={project as Project}
      project_signup_id={project_signup_id}
      isProjectCancelled={isProjectCancelled} // Pass the cancelled status
    />
  );
}
