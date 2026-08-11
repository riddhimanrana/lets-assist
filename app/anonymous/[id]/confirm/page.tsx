import { revalidatePath } from "next/cache";
import { SuccessMessage } from "./SuccessMessage";
import { ErrorMessage } from "./ErrorMessage";
import { Loader2 } from "lucide-react";
import { getAnonymousSignupAccessRecord } from "@/lib/anonymous-signup-access";
import { confirmAnonymousSignupWithCapacity } from "@/lib/projects/signup-capacity";

// Define possible confirmation statuses
type ConfirmationStatus =
  "success" | "error" | "invalid" | "already_confirmed" | "processing";

// Helper function to perform the confirmation logic
async function performConfirmation(
  anonymousSignupId: string,
  token: string,
): Promise<{ status: ConfirmationStatus; message?: string }> {
  try {
    const { data: anonSignup, error: findError } =
      await getAnonymousSignupAccessRecord<{
        id: string;
        confirmed_at: string | null;
        project_id: string | null;
      }>({
        anonymousSignupId,
        token,
        columns: "id, confirmed_at, project_id",
      });

    if (findError) {
      console.error("Error finding anonymous signup:", findError);
      return { status: "error", message: "Database error finding signup." };
    }

    if (!anonSignup) {
      console.error("Confirmation failed: Invalid token or ID");
      return { status: "invalid" };
    }

    // Confirmation and every pending-to-approved transition happen in one
    // capacity-locked database transaction. A full slot leaves all rows
    // unmodified so the volunteer never receives a partial confirmation.
    const confirmation =
      await confirmAnonymousSignupWithCapacity(anonymousSignupId);
    if (confirmation.error || !confirmation.data) {
      console.error(
        "Error atomically confirming anonymous signup:",
        confirmation.error,
      );
      return { status: "error", message: "Database error confirming signup." };
    }

    if (confirmation.data.outcome === "slot_full") {
      return {
        status: "error",
        message:
          "One of the selected slots just filled up. Your signup was not confirmed; please choose another slot.",
      };
    }
    if (
      confirmation.data.outcome !== "confirmed" &&
      confirmation.data.outcome !== "already_confirmed"
    ) {
      return {
        status: "error",
        message: "This signup can no longer be confirmed.",
      };
    }

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

    return {
      status:
        confirmation.data.outcome === "already_confirmed" ||
        anonSignup.confirmed_at
          ? "already_confirmed"
          : "success",
    };
  } catch (error) {
    console.error("Unexpected error during confirmation:", error);
    return { status: "error", message: "An unexpected error occurred." };
  }
}

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function ConfirmationPage({
  params,
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const { id: anonymousSignupId } = await params;
  const resolvedSearchParams = await searchParams;
  const token = resolvedSearchParams?.token as string | undefined;

  let confirmationResult: { status: ConfirmationStatus; message?: string } = {
    status: "processing",
  };

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
      return (
        <SuccessMessage
          anonymousSignupId={anonymousSignupId}
          anonymousAccessToken={token || ""}
        />
      );
    case "invalid":
      return (
        <ErrorMessage message="The confirmation link is invalid or missing required information." />
      );
    case "error":
      return (
        <ErrorMessage
          message={
            confirmationResult.message ||
            "An error occurred during confirmation."
          }
        />
      );
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
