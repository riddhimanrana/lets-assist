import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";
import { SuccessMessage } from "./SuccessMessage";
import { ErrorMessage } from "./ErrorMessage";
import { Loader2 } from "lucide-react";

// Define possible confirmation statuses
type ConfirmationStatus = "success" | "error" | "invalid" | "already_confirmed" | "processing";

// Helper function to perform the confirmation logic
async function performConfirmation(anonymousSignupId: string, token: string): Promise<{ status: ConfirmationStatus; message?: string }> {
  const supabase = await createClient();

  try {
    // 1. Find the anonymous signup record using token and ID
    const { data: anonSignup, error: findError } = await supabase
      .from("anonymous_signups")
      .select("id, confirmed_at, project_id")
      .eq("id", anonymousSignupId)
      .eq("token", token)
      .maybeSingle();

    if (findError) {
      console.error("Error finding anonymous signup:", findError);
      return { status: "error", message: "Database error finding signup." };
    }

    if (!anonSignup) {
      console.error("Confirmation failed: Invalid token or ID");
      return { status: "invalid" };
    }

    // 2. Check if already confirmed
    if (anonSignup.confirmed_at) {
      console.log("Signup already confirmed:", anonymousSignupId);
      return { status: "already_confirmed" };
    }

    // --- Start Transaction ---
    // 3. Update anonymous_signups: set confirmed_at
    const timestamp = new Date().toISOString(); // Store timestamp
    console.log(`Attempting to update confirmed_at for anonymous_signup ID: ${anonymousSignupId} with timestamp: ${timestamp}`); // Log before update

    const { error: confirmError } = await supabase
      .from("anonymous_signups")
      .update({ confirmed_at: timestamp }) // Use stored timestamp
      .eq("id", anonymousSignupId);

    console.log(`Update result for confirmed_at (ID: ${anonymousSignupId}):`, { confirmError }); // Log after update

    if (confirmError) {
      console.error("Error confirming anonymous signup:", confirmError);
      return { status: "error", message: "Database error confirming signup." };
    }

    // 4. Find the corresponding project_signup using anonymous_id
    const { data: projectSignup, error: findProjectSignupError } = await supabase
      .from("project_signups")
      .select("id")
      .eq("anonymous_id", anonymousSignupId)
      .eq("status", "pending")
      .maybeSingle();

    if (findProjectSignupError) {
        console.error("Error finding project signup record:", findProjectSignupError);
        return { status: "error", message: "Database error finding project signup." };
    }

    if (!projectSignup) {
        console.error("Confirmation failed: Could not find matching pending project signup for anonymous ID:", anonymousSignupId);
        return { status: "error", message: "Could not find matching pending project signup." };
    }

    // 5. Update project_signups: set status to 'approved'
    const { error: statusError } = await supabase
      .from("project_signups")
      .update({ status: "approved" })
      .eq("id", projectSignup.id);

    if (statusError) {
      console.error("Error updating project signup status:", statusError);
      return { status: "error", message: "Database error updating project status." };
    }

    console.log("Successfully confirmed signup:", anonymousSignupId, "and updated project signup:", projectSignup.id);

    // Revalidate relevant paths
    try {
        if (anonSignup.project_id) {
            revalidatePath(`/projects/${anonSignup.project_id}`);
            revalidatePath(`/projects/${anonSignup.project_id}/signups`);
        }
        revalidatePath(`/anonymous/${anonymousSignupId}`);
    } catch (revalidateError) {
        console.warn("Path revalidation failed (non-critical):", revalidateError);
    }

    return { status: "success" };

  } catch (error) {
    console.error("Unexpected error during confirmation:", error);
    return { status: "error", message: "An unexpected error occurred." };
  }
}


interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function ConfirmationPage({ params, searchParams }: PageProps): Promise<React.ReactElement>{
  const { id: anonymousSignupId } = await params;
  const resolvedSearchParams = await searchParams;
  const token = resolvedSearchParams?.token as string | undefined;

  let confirmationResult: { status: ConfirmationStatus; message?: string } = { status: "processing" };

  if (!token || !anonymousSignupId) {
    console.error("Confirmation failed: Missing token or ID in URL");
    confirmationResult = { status: "invalid" };
  } else {
    // Perform the confirmation logic on the server
    confirmationResult = await performConfirmation(anonymousSignupId, token);
  }

  // Render UI based on the result
  switch (confirmationResult.status) {
    case "success":
    case "already_confirmed": // Treat already confirmed as success for UI
      return <SuccessMessage anonymousSignupId={anonymousSignupId} />;
    case "invalid":
      return <ErrorMessage message="The confirmation link is invalid or missing required information." />;
    case "error":
      return <ErrorMessage message={confirmationResult.message || "An error occurred during confirmation."} />;
    case "processing": // Should ideally not be shown unless there's an issue before calling performConfirmation
    default:
      return (
         <div className="container mx-auto flex min-h-[calc(100vh-150px)] items-center justify-center px-4 py-10">
            <div className="flex flex-col items-center gap-4 text-muted-foreground">
                <Loader2 className="h-12 w-12 animate-spin" />
                <p>Processing confirmation...</p>
            </div>
         </div>
      );
  }
}
