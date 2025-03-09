import { notFound } from "next/navigation";
import { getProject } from "../actions";
import EditProjectClient from "./EditProjectClient";

type Props = {
  params: { id: string };
};

export default async function EditProjectPage({ params }: Props) {
  const { project, error } = await getProject(params.id);

  if (error || !project) {
    notFound();
  }

  return <EditProjectClient project={project} />;
}