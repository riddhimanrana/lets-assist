import { notFound } from "next/navigation";
import { getProject } from "../actions";
import EditProjectClient from "./EditProjectClient";

type Props = {
  params: Promise<{ id: string }> | { id: string };
};

export default async function EditProjectPage({ params }: Props) {
  const resolvedParams = await params;
  const { project, error } = await getProject(resolvedParams.id);

  if (error || !project) {
    notFound();
  }

  return <EditProjectClient project={project} />;
}