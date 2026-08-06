import "server-only";

import type { Project, ProjectSignup } from "@/types";
import type { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/services/email";
import UserSignupConfirmation from "@/emails/user-signup-confirmation";
import * as React from "react";

import {
  getProjectSignupInsertErrorMessage,
  getScheduleDetails,
  insertProjectSignupAtomically,
  logSignupDebug,
  siteUrl,
  summarizePostgrestError,
} from "./shared";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export async function registerAuthenticatedSignup({
  supabase,
  user,
  project,
  projectId,
  scheduleId,
  volunteerComment,
  formData,
  traceId,
}: {
  supabase: ServerClient;
  user: { id: string };
  project: Project;
  projectId: string;
  scheduleId: string;
  volunteerComment: string | null;
  formData?: Record<string, unknown>;
  traceId: string;
}) {
  try {
    const { data: previousRejection } = await supabase
      .from("project_signups")
      .select("id")
      .eq("project_id", projectId)
      .eq("schedule_id", scheduleId)
      .eq("user_id", user.id)
      .eq("status", "rejected")
      .maybeSingle();

    if (previousRejection) {
      logSignupDebug(traceId, "blocked_previous_rejection", {
        previousSignupId: previousRejection.id,
      });
      return {
        response: {
          error:
            "You have been rejected for this project and cannot sign up again.",
        },
      };
    }

    const { data: existingSignup } = await supabase
      .from("project_signups")
      .select("id")
      .eq("project_id", projectId)
      .eq("schedule_id", scheduleId)
      .eq("user_id", user.id)
      .in("status", ["approved", "pending"])
      .maybeSingle();

    if (existingSignup) {
      logSignupDebug(traceId, "blocked_existing_signup", {
        existingSignupId: existingSignup.id,
      });
      return {
        response: { error: "You have already signed up for this slot" },
      };
    }

    const signupData: Omit<ProjectSignup, "id" | "created_at"> = {
      project_id: projectId,
      schedule_id: scheduleId,
      user_id: user.id,
      status: "approved",
      anonymous_id: null,
      volunteer_comment: volunteerComment,
      response_data: formData || null,
    };

    const { data: insertedSignup, error: signupError } =
      await insertProjectSignupAtomically(signupData, traceId);

    if (signupError || !insertedSignup) {
      logSignupDebug(traceId, "registered_insert_failed", {
        error: summarizePostgrestError(signupError),
      });
      return {
        response: { error: getProjectSignupInsertErrorMessage(signupError) },
      };
    }

    try {
      const { data: userProfile } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", user.id)
        .single();

      if (userProfile?.email) {
        const { date, timeRange } = getScheduleDetails(project, scheduleId);
        const projectUrl = `${siteUrl}/projects/${projectId}`;
        const { data: emailData, error: emailError } = await sendEmail({
          to: userProfile.email,
          subject: `Signup confirmed for ${project.title}`,
          react: React.createElement(UserSignupConfirmation, {
            projectName: project.title,
            userName: userProfile.full_name || "Volunteer",
            projectDate: date,
            projectTime: timeRange,
            projectLocation: project.location,
            projectUrl,
          }),
          userId: user.id,
          type: "transactional",
        });

        if (emailError) {
          logSignupDebug(traceId, "registered_confirmation_email_failed", {
            error: summarizePostgrestError(emailError),
          });
        } else {
          logSignupDebug(traceId, "registered_confirmation_email_sent", {
            emailId:
              typeof emailData === "object" && emailData
                ? (emailData as { id?: string }).id
                : undefined,
          });
        }
      }
    } catch (emailError) {
      logSignupDebug(traceId, "registered_confirmation_email_exception", {
        error:
          emailError instanceof Error ? emailError.message : String(emailError),
      });
    }

    logSignupDebug(traceId, "registered_signup_created", {
      userId: user.id,
      projectId,
      scheduleId,
      signupId: insertedSignup.id,
    });

    return { createdSignupId: insertedSignup.id };
  } catch (error) {
    logSignupDebug(traceId, "registered_signup_exception", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { response: { error: "An error occurred during signup" } };
  }
}
