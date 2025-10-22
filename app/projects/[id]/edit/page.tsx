import { notFound } from "next/navigation";
import { getProject } from "../actions";
import EditProjectClient from "./EditProjectClient";

type Props = {
  params: Promise<{ id: string }>;
  // searchParams?: { [key: string]: string | string[] | undefined };
};

export default async function EditProjectPage({ params }: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const { project, error } = await getProject(id);

  if (error || !project) {
    notFound();
  }

  return <EditProjectClient project={project} />;
}