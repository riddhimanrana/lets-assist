import { notFound } from "next/navigation";
import { getProject } from "../actions";
import ManageSignupsClient from "./SignupsClient";

type Props = {
  params: Promise<{ id: string }> | { id: string };
};

export default async function ManageSignupsPage({ params }: Props) {
  const resolvedParams = await params;
  const { project, error } = await getProject(resolvedParams.id);

  if (error || !project) {
    notFound();
  }

  return <ManageSignupsClient project={project} />;
}