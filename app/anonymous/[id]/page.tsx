import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { notFound, redirect } from "next/navigation";
import { Project } from "@/types";
import AnonymousSignupClient from "./AnonymousSignupClient";
import {
  getAnonymousSignupAccessRecord,
  normalizeAnonymousSignupToken,
} from "@/lib/anonymous-signup-access";

interface PageProps {
  params: Promise<{ id: string}>;
  searchParams: Promise<{ token?: string }>;
}

export default async function AnonymousSignupPage({
  params,
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const param = await params;
  const resolvedSearchParams = await searchParams;
  const signupId = param.id;
  const accessToken = normalizeAnonymousSignupToken(resolvedSearchParams.token);
  
  if (!signupId || !accessToken) {
    notFound();
  }
  
  const supabase = await createClient();
  const admin = getAdminClient();

  const { data: signupData, error } = await getAnonymousSignupAccessRecord({
    anonymousSignupId: signupId,
    token: accessToken,
  });

  if (error || !signupData) {
    console.error("Error fetching anonymous signup:", error);
    notFound();
  }

  // Fetch ALL project_signups linked to this anonymous profile (1:many)
  const { data: projectSignups, error: signupsError } = await admin
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
    if (signupData.linked_user_id) {
      redirect("/dashboard");
    }
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

  let certificateIds: Record<string, string> = {};
  const signupIds = slots.map((slot) => slot.project_signup_id);
  if (signupIds.length > 0) {
    const { data: certificates, error: certificatesError } = await admin
      .from("certificates")
      .select("id, signup_id")
      .in("signup_id", signupIds);

    if (certificatesError) {
      console.error("Error fetching anonymous certificates:", certificatesError);
    } else if (certificates) {
      certificateIds = certificates.reduce<Record<string, string>>((acc, cert) => {
        if (cert.signup_id) {
          acc[cert.signup_id] = cert.id;
        }
        return acc;
      }, {});
    }
  }

  return (
    <AnonymousSignupClient
      id={signupId}
      accessToken={accessToken}
      name={name}
      email={email}
      phone_number={phone_number}
      confirmed_at={confirmed_at}
      created_at={created_at}
      project={project as Project}
      isProjectCancelled={isProjectCancelled}
      slots={slots}
      linkedUserId={linked_user_id}
      certificateIds={certificateIds}
    />
  );
}
