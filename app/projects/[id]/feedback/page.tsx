import { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getProjectFeedbackSummary } from "../actions";
import { createClient } from "@/lib/supabase/server";
import { FeedbackClient } from "./FeedbackClient";

export const metadata: Metadata = {
  title: "Volunteer feedback",
};

export default async function ProjectFeedbackPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = await params;

  const { user, error: authError } = await getAuthUser();
  if (authError || !user) {
    redirect(`/login?redirect=/projects/${projectId}/feedback`);
  }

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, title")
    .eq("id", projectId)
    .single();
  if (!project) notFound();

  // getProjectFeedbackSummary applies the canManageProjectAccess gate and
  // reads through the caller's own RLS as a second gate.
  const result = await getProjectFeedbackSummary(projectId);
  if (!result.success) notFound();

  return (
    <FeedbackClient
      projectId={projectId}
      projectTitle={project.title}
      summary={result.summary}
      entries={result.entries}
    />
  );
}
