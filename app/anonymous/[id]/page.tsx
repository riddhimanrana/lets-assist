import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { Project } from "@/types";
import AnonymousSignupClient from "./AnonymousSignupClient";

interface PageProps {
  params: Promise<{ id: string}>
}

export default async function AnonymousSignupPage({ params }: PageProps): Promise<React.ReactElement> {
  const param = await params;
  const signupId = param.id;
  
  if (!signupId) {
    notFound();
  }
  
  const supabase = await createClient();

  // Fetch anonymous signup profile
  const { data: signupData, error } = await supabase
    .from("anonymous_signups")
    .select("*")
    .eq("id", signupId)
    .maybeSingle();

  if (error || !signupData) {
    console.error("Error fetching anonymous signup:", error);
    notFound();
  }

  // Fetch ALL project_signups linked to this anonymous profile (1:many)
  const { data: projectSignups, error: signupsError } = await supabase
    .from("project_signups")
    .select(`
      id,
      status,
      schedule_id,
      check_in_time,
      check_out_time,
      volunteer_comment
    `)
    .eq("anonymous_id", signupId)
    .order("created_at", { ascending: true });

  if (signupsError) {
    console.error("Error fetching project signups:", signupsError);
    notFound();
  }

  if (!projectSignups || projectSignups.length === 0) {
    console.error("No linked project signups found");
    notFound();
  }

  // Fetch the project data
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("*")
    .eq("id", signupData.project_id)
    .single();

  if (projectError || !project) {
    console.error("Error fetching project:", projectError);
    notFound();
  }

  const isProjectCancelled = project.status === 'cancelled';

  const { name, email, phone_number, confirmed_at, created_at, linked_user_id } = signupData;

  // Map signup data for the client component
  const slots = projectSignups.map((ps: { id: string; status: string; schedule_id: string; check_in_time: string | null; check_out_time: string | null; volunteer_comment: string | null }) => ({
    project_signup_id: ps.id,
    status: ps.status,
    schedule_id: ps.schedule_id,
    check_in_time: ps.check_in_time,
    check_out_time: ps.check_out_time,
  }));

  return (
    <AnonymousSignupClient
      id={signupId}
      name={name}
      email={email}
      phone_number={phone_number}
      confirmed_at={confirmed_at}
      created_at={created_at}
      project={project as Project}
      isProjectCancelled={isProjectCancelled}
      slots={slots}
      linkedUserId={linked_user_id}
    />
  );
}
