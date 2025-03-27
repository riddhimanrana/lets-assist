import { notFound } from "next/navigation";
import { getProject } from "../actions";
import DocumentsClient from "./DocumentsClient";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function DocumentsPage({ params }: Props) {
  const { id } = await params;
  const { project, error } = await getProject(id);

  if (error || !project) {
    notFound();
  }

  return <DocumentsClient project={project} />;
}