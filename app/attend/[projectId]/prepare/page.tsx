import { Suspense } from 'react';
import PrepareClient from './PrepareClient'; // Import the client component
import { Loader2 } from 'lucide-react';

interface PreparePageProps {
  params: Promise<{
    projectId: string;
  }>;
  // searchParams are implicitly available but not needed directly here
}

// Simple fallback component for Suspense
function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
       <Loader2 className="h-12 w-12 animate-spin text-primary" aria-label="Loading page" />
    </div>
  );
}

// This is a Server Component that renders the Client Component
export default async function PreparePage({ params }: PreparePageProps) {
  const { projectId } = await params;

  // Basic validation for projectId format if needed
  if (!projectId || typeof projectId !== 'string' || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(projectId)) {
     console.error("PreparePage: Invalid projectId format received:", projectId);
     // Render an error message or redirect
     return (
        <div className="flex items-center justify-center min-h-screen text-destructive">
            Error: Invalid Project ID in URL.
        </div>
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
