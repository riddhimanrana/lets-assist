import "server-only";

import { safeConsole } from "@/lib/safe-console";
import type { createClient } from "@/lib/supabase/server";
import { getWaiverConfigurationError } from "@/lib/projects/waiver-validation";
import { revalidatePath } from "next/cache";
import { parseCreateProjectPayload } from "@/schemas/project-create-schema";
import { createBasicProject } from "./create";
import { normalizeIdempotencyKey } from "./create-support";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Publishes one saved draft for its owner and removes the draft afterwards.
 *
 * The draft UUID also identifies its one publication attempt, including a
 * retry after the draft was removed but the successful response was lost.
 */
export async function publishSavedDraft(
  supabase: ServerClient,
  userId: string,
  draftId: string,
) {
  const attemptKey = normalizeIdempotencyKey(draftId);
  if (!attemptKey) return { error: "Draft not found" };

  const findPublishedAttempt = () =>
    supabase
      .from("projects")
      .select("id, workflow_status")
      .eq("creator_id", userId)
      .eq("creation_idempotency_key", attemptKey)
      .maybeSingle();
  const attemptCheckFailed = {
    error: "Could not check this draft's publication. Please try again.",
  };

  const { data: publishedAttempt, error: attemptError } =
    await findPublishedAttempt();
  if (attemptError) return attemptCheckFailed;

  // The project is already published by the time the draft is removed, so a
  // failed removal is reported as a retained draft, never as a failed publish.
  const finishPublication = async (projectId: string) => {
    const { error: cleanupError } = await supabase
      .from("project_drafts")
      .delete()
      .eq("id", attemptKey)
      .eq("user_id", userId);
    if (cleanupError) {
      safeConsole.error("Error removing published draft:", cleanupError);
    }
    revalidatePath("/projects");
    revalidatePath("/projects/drafts");
    revalidatePath("/projects/create");
    revalidatePath(`/projects/${projectId}`);
    return {
      success: true,
      id: projectId,
      ...(cleanupError
        ? {
            draftRetained: true,
            message:
              "Project published. Its draft could not be removed; publishing it again will retry cleanup without creating another project.",
          }
        : {}),
    };
  };
  if (publishedAttempt && publishedAttempt.workflow_status !== "draft") {
    return finishPublication(publishedAttempt.id);
  }

  // Get the draft data
  const { data: draft, error: draftError } = await supabase
    .from("project_drafts")
    .select("*")
    .eq("id", attemptKey)
    .eq("user_id", userId)
    .maybeSingle();

  if (draftError) {
    safeConsole.error("Error loading draft to publish:", draftError);
    return { error: "This draft could not be loaded. Please try again." };
  }

  if (!draft) {
    // A concurrent publish of the same draft may have finished between the
    // first check and this read. It converges on that project instead of
    // reporting a missing draft for a publication that succeeded.
    const { data: concurrentAttempt, error: concurrentError } =
      await findPublishedAttempt();
    if (concurrentError) return attemptCheckFailed;
    if (concurrentAttempt && concurrentAttempt.workflow_status !== "draft") {
      return finishPublication(concurrentAttempt.id);
    }
    return { error: "Draft not found" };
  }

  // A draft is saved with relaxed rules, so it can be missing anything. It is
  // checked against the create form's rules here, and the first thing that
  // still needs attention is named instead of a generic failure.
  const draftValidation = parseCreateProjectPayload(draft.draft_data);
  if (!draftValidation.ok) {
    return { error: draftValidation.error };
  }
  const projectData = draftValidation.data;

  const waiverConfigurationError = getWaiverConfigurationError(projectData);
  if (waiverConfigurationError) {
    return { error: waiverConfigurationError };
  }

  // Drafts intentionally never carry the uploaded waiver PDF, so this path
  // cannot prove one. Refusing here beats creating a project that would stay
  // staged and unpublishable with nobody to finish it.
  if (projectData?.waiverRequired) {
    return {
      error:
        "Projects that require a waiver must be published from the create flow so the waiver PDF can be attached.",
    };
  }

  const basicResult = await createBasicProject(
    { ...draft.draft_data, creationIdempotencyKey: attemptKey },
    false,
  );

  if (basicResult.error) {
    return basicResult;
  }

  if (!basicResult.id) {
    return { error: "This draft could not be published. Please try again." };
  }

  // The key resolved to a row another flow staged for a waiver. It is not
  // published, so the draft is kept.
  if (basicResult.requiresWaiverPublication) {
    return {
      error:
        "This project is waiting for its waiver. Finish it from the create flow; the draft has been kept.",
    };
  }
  return finishPublication(basicResult.id);
}
