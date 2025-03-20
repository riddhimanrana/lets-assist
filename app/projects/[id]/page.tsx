import { notFound, redirect } from "next/navigation";
import { getProject, getCreatorProfile } from "./actions";
import ProjectDetails from "./ProjectDetails";
import ProjectUnauthorized from "./ProjectUnauthorized";
import { Metadata } from "next";

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata(
  { params }: Props,
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
  { params }: Props,
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

  return <ProjectDetails project={project} creator={creator || null} />;
}
