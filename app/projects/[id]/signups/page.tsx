import { Metadata } from "next";
import { use } from "react";
import { SignupsClient } from "./SignupsClient";
import { getProject } from "../actions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { project } = await getProject(id);
  const title = project ? `Signups — ${project.title}` : "Project Signups";

  return {
    title,
    description: project
      ? `Review volunteer signups for ${project.title}.`
      : "Review volunteer signups for this project.",
  };
}

export default function SignupsPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  return <SignupsClient projectId={resolvedParams.id} />;
}