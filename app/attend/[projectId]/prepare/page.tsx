import { safeConsole } from "@/lib/safe-console";
import { Suspense } from "react";
import PrepareClient from "./PrepareClient"; // Import the client component
import { CircleAlert } from "lucide-react";
import { NoticePage } from "@/components/projects/NoticePage";
import { Spinner } from "@/components/ui/spinner";

interface PreparePageProps {
  params: Promise<{
    projectId: string;
  }>;
  // searchParams are implicitly available but not needed directly here
}

// Simple fallback component for Suspense
function LoadingFallback() {
  return (
    <NoticePage
      icon={<Spinner aria-label="Loading page" />}
      title="Verifying attendance link"
    />
  );
}

// This is a Server Component that renders the Client Component
export default async function PreparePage({ params }: PreparePageProps) {
  const { projectId } = await params;

  // Basic validation for projectId format if needed
  if (
    !projectId ||
    typeof projectId !== "string" ||
    !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      projectId,
    )
  ) {
    safeConsole.error(
      "PreparePage: Invalid projectId format received:",
      projectId,
    );
    // Render an error message or redirect
    return (
      <NoticePage
        icon={<CircleAlert aria-hidden="true" />}
        tone="destructive"
        title="Invalid attendance link"
        description="The project ID in this link is not valid. Please scan the QR code provided by the project organizer."
      />
    );
  }

  return (
    // Use Suspense to handle potential loading states if PrepareClient were more complex
    // or if searchParams were read here using useSearchParams hook (which requires Suspense)
    <Suspense fallback={<LoadingFallback />}>
      {/* Render the client component, passing the projectId */}
      <PrepareClient projectId={projectId} />
    </Suspense>
  );
}
