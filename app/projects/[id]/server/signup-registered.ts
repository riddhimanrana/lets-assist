import "server-only";

import crypto from "crypto";

import type { Project, ProjectSignup, WaiverSignatureInput } from "@/types";
import type { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/services/email";
import UserSignupConfirmation from "@/emails/user-signup-confirmation";
import * as React from "react";

import {
  getProjectSignupInsertErrorMessage,
  getScheduleDetails,
  insertProjectSignupAtomically,
  logSignupDebug,
  releaseUncommittedWaiverEvidence,
  resolveWaiverSignerIdentity,
  siteUrl,
  summarizePostgrestError,
} from "./shared";
import { prepareWaiverSignatureRecord } from "./waiver-assets";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export async function registerAuthenticatedSignup({
  supabase,
  user,
  project,
  projectId,
  scheduleId,
  volunteerComment,
  waiverSignature,
  formData,
  traceId,
}: {
  supabase: ServerClient;
  user: {
    id: string;
    email?: string | null;
    user_metadata?: { full_name?: string } | null;
  };
  project: Project;
  projectId: string;
  scheduleId: string;
  volunteerComment: string | null;
  waiverSignature?: WaiverSignatureInput | null;
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

    // Signature assets are uploaded before the transaction, but the evidence
    // row is written by it. Nothing here creates a signup that could outlive a
    // refused or failed waiver.
    let waiverRecord = null;
    let evidencePaths: string[] = [];

    if (waiverSignature) {
      const signer = resolveWaiverSignerIdentity({
        signerNameInput: waiverSignature.signerName,
        signerEmailInput: waiverSignature.signerEmail,
        sessionEmail: user.email,
        sessionFullName: user.user_metadata?.full_name,
        isSessionActor: true,
      });

      if (!signer) {
        return {
          response: { error: "Signer email is required for the waiver." },
        };
      }

      const prepared = await prepareWaiverSignatureRecord({
        projectId,
        evidenceKey: crypto.randomUUID(),
        signerName: signer.signerName,
        signerEmail: signer.signerEmail,
        waiverSignature,
      });
      evidencePaths = prepared.uploadedPaths;

      if ("error" in prepared) {
        await releaseUncommittedWaiverEvidence(evidencePaths, traceId);
        logSignupDebug(traceId, "registered_waiver_prepare_failed");
        return { response: { error: prepared.error } };
      }

      waiverRecord = prepared.record;
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
      await insertProjectSignupAtomically(signupData, traceId, {
        waiver: waiverRecord,
      });

    if (signupError || !insertedSignup) {
      await releaseUncommittedWaiverEvidence(evidencePaths, traceId);
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
