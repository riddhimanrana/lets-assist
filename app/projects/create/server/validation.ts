"use server";
import { safeConsole } from "@/lib/safe-console";

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { basicInfoSchema } from "@/schemas/event-form-schema";
import { checkOffensiveLanguage } from "@/utils/moderation-helpers";
import { PROJECT_CLIENT_SELECT } from "@/lib/projects/client-projection";

const projectContentSchema = basicInfoSchema
  .pick({ title: true, location: true, description: true })
  .strict();

type ProjectContentCheck = {
  success: boolean;
  hasProfanity: boolean;
  error?: string;
  fieldResults?: Record<
    string,
    { isProfanity: boolean; score?: number; flaggedFor?: string[] }
  >;
};

export async function checkProfanity(content: {
  [key: string]: string;
}): Promise<ProjectContentCheck> {
  "use server";
  try {
    const { user, error } = await getAuthUser({
      sensitive: true,
      checkMfa: true,
    });
    if (error || !user) {
      return {
        success: false,
        hasProfanity: false,
        error: "Content could not be checked. Sign in again and retry.",
      };
    }
    const parsed = projectContentSchema.safeParse(content);
    if (!parsed.success) {
      return {
        success: false,
        hasProfanity: false,
        error:
          "Check the title, location, and description lengths and try again.",
      };
    }
    const fieldResults: Record<string, { isProfanity: boolean }> = {};
    for (const [field, text] of Object.entries(parsed.data)) {
      fieldResults[field] = {
        isProfanity: (await checkOffensiveLanguage(text)).isProfane,
      };
    }
    return {
      success: true,
      hasProfanity: Object.values(fieldResults).some(
        (result) => result.isProfanity,
      ),
      fieldResults,
    };
  } catch {
    return {
      success: false,
      hasProfanity: false,
      error:
        "Content could not be checked. Please retry before creating your project.",
    };
  }
}

/**
 * Fetches a project by ID with all necessary data for calendar integration
 */
export async function getProjectById(projectId: string) {
  "use server";
  try {
    const supabase = await createClient();

    const { data: project, error } = await supabase
      .from("projects")
      .select(
        `
        ${PROJECT_CLIENT_SELECT},
        profiles:creator_id (
          id,
          full_name,
          email
        )
      `,
      )
      .eq("id", projectId)
      .single();

    if (error) {
      safeConsole.error("Error fetching project:", error);
      return { error: "Failed to fetch project" };
    }

    return { project };
  } catch (error) {
    safeConsole.error("Error in getProjectById:", error);
    return { error: "Failed to fetch project" };
  }
}
