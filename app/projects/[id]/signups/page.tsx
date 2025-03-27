import { use } from "react";
import { SignupsClient } from "./SignupsClient";

export default function SignupsPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  return <SignupsClient projectId={resolvedParams.id} />;
}