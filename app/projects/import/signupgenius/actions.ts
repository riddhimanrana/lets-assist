"use server";

import { createBasicProject } from "../../create/actions";
import {
  buildSignupGeniusPreview,
  getSignupGeniusReport,
  listSignupGeniusCreatedSignups,
  matchSignupByInput,
} from "@/services/signupgenius";
import type {
  SignupGeniusImportOptions,
  SignupGeniusImportResult,
} from "@/types/signupgenius";

const getString = (
  record: Record<string, unknown>,
  keys: string[]
): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
};

export async function previewSignupGeniusImport(
  input: string
): Promise<SignupGeniusImportResult> {
  try {
    const signups = await listSignupGeniusCreatedSignups("all");

    if (!input.trim()) {
      return {
        error: "Paste a SignUpGenius link, ID, or choose a signup below.",
        signups,
      };
    }

    const match = matchSignupByInput(input, signups);
    if (!match) {
      return {
        error: "We couldn’t match that URL or ID. Try selecting from the list.",
        signups,
      };
    }

    const report = await getSignupGeniusReport(match.id, "all");
    const preview = buildSignupGeniusPreview(match, report);

    return { preview, signups };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Failed to load SignUpGenius data.",
    };
  }
}

export async function importSignupGeniusSignup(
  input: string,
  options: SignupGeniusImportOptions
): Promise<{ success?: boolean; projectId?: string; error?: string }>
{
  const previewResult = await previewSignupGeniusImport(input);
  if (!previewResult.preview) {
    return { error: previewResult.error || "Unable to build a preview." };
  }

  const preview = previewResult.preview;
  if (preview.blockingIssues.length > 0) {
    return {
      error: "Fix the blocking issues before importing the signup.",
    };
  }

  const raw = preview.signup.raw || {};
  const description =
    getString(raw, ["description", "details", "info", "instructions"]) ||
    "Imported from SignUpGenius.";

  const location =
    getString(raw, ["location", "address", "where", "place"]) || "TBD";

  const projectData = {
    basicInfo: {
      title: preview.signup.title || "Imported SignUpGenius Project",
      description,
      location,
      locationData: undefined,
      organizationId: options.organizationId || undefined,
      projectTimezone: preview.signup.timezone || "America/Los_Angeles",
    },
    eventType: preview.eventType,
    schedule: preview.schedule,
    verificationMethod: "signup-only",
    requireLogin: options.requireLogin ?? true,
    enableVolunteerComments: true,
    showAttendeesPublicly: false,
    visibility:
      options.visibility ||
      (options.organizationId ? "organization_only" : preview.suggestedVisibility),
    restrictToOrgDomains: false,
  };

  const result = await createBasicProject(projectData);
  if (result.error) {
    return { error: result.error };
  }

  return { success: true, projectId: result.id };
}
