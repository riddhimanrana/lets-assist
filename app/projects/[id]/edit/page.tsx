import { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUserProjectPermissions, getProject } from "../actions";
import EditProjectClient from "./EditProjectClient";

type Props = {
  params: Promise<{ id: string }>;
  // searchParams?: { [key: string]: string | string[] | undefined };
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { project } = await getProject(id);
  const title = project ? `Edit ${project.title}` : "Edit Project";

  return {
    title,
    description: project
      ? `Update details and settings for ${project.title}.`
      : "Update project details and settings.",
  };
}

export default async function EditProjectPage({ params }: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const { project, error } = await getProject(id);
  const { canManageProject } = await getCurrentUserProjectPermissions(id);

  if (error || !project || !canManageProject) {
    notFound();
  }

  return <EditProjectClient project={project} />;
}