import { notFound } from "next/navigation";
import { getProject } from "../actions";
import ManageSignupsClient from "./SignupsClient";

type Props = {
  params: { id: string };
};

export default async function ManageSignupsPage({ params }: Props) {
  const { project, error } = await getProject(params.id);

  if (error || !project) {
    notFound();
  }

  return <ManageSignupsClient project={project} />;
}