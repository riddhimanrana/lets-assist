import "server-only";

import { createClient } from "@/lib/supabase/server";

export async function checkProfanity(content: { [key: string]: string }) {
  "use server";
  try {
    // Create a results object to store checks for each field
    const results: {
      [key: string]: {
        isProfanity: boolean;
        score?: number;
        flaggedFor?: string[];
      };
    } = {};

    let hasProfanity = false;

    // Check each field separately
    for (const [field, text] of Object.entries(content)) {
      if (!text || text.trim() === "") {
        results[field] = { isProfanity: false };
        continue; // Skip empty fields
      }

      try {
        const response = await fetch("https://vector.profanity.dev", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });

        if (!response.ok) {
          // If API call fails for this field, assume no profanity
          results[field] = { isProfanity: false };
          continue;
        }

        const result = await response.json();

        results[field] = {
          isProfanity: !!result.isProfanity,
          score: result.score,
          flaggedFor: result.flaggedFor,
        };

        // If any field has profanity, mark the overall result as having profanity
        if (result.isProfanity) {
          hasProfanity = true;
        }
      } catch (error) {
        // If check fails for this field, assume no profanity
        console.error(`Error checking profanity for ${field}:`, error);
        results[field] = { isProfanity: false };
      }
    }

    return {
      success: true,
      hasProfanity,
      fieldResults: results,
    };
  } catch (error) {
    console.error("Error in profanity check function:", error);
    // If overall check fails, default to allowing content
    return { success: true, hasProfanity: false };
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
        *,
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
      console.error("Error fetching project:", error);
      return { error: "Failed to fetch project" };
    }

    return { project };
  } catch (error) {
    console.error("Error in getProjectById:", error);
    return { error: "Failed to fetch project" };
  }
}
