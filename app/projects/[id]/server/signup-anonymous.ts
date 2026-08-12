import "server-only";

import crypto from "crypto";
import * as React from "react";

import type {
  AnonymousSignupData,
  Project,
  ProjectSignup,
  WaiverSignatureInput,
} from "@/types";
import type { getAdminClient } from "@/lib/supabase/admin";
import AnonymousSignupConfirmation from "@/emails/anonymous-signup-confirmation";
import { sendEmail } from "@/services/email";
import { verifyAnonymousSignupContinuation } from "@/lib/anonymous-signup-continuation";
import { confirmAnonymousSignupWithCapacity } from "@/lib/projects/signup-capacity";

import {
  type WaiverSignatureRecord,
  getProjectSignupInsertErrorMessage,
  getScheduleDetails,
  insertProjectSignupAtomically,
  logSignupDebug,
  releaseUncommittedWaiverEvidence,
  resolveWaiverSignerIdentity,
  siteUrl,
  summarizePostgrestError,
  validateAnonymousSignupCaptcha,
} from "./shared";
import {
  prepareClonedAnonymousWaiverRecord,
  prepareWaiverSignatureRecord,
} from "./waiver-assets";

type PreparedGuestWaiver =
  | { record: WaiverSignatureRecord | null; evidencePaths: string[] }
  | { error: string; evidencePaths: string[] };

/**
 * Builds the guest waiver evidence row, either from this submission or by
 * copying the profile's most recent signature. Nothing is written here; the
 * signup transaction inserts the row it returns.
 */
async function prepareGuestWaiverEvidence(params: {
  projectId: string;
  anonymousData: AnonymousSignupData;
  waiverSignature?: WaiverSignatureInput | null;
  reuseAnonymousId?: string | null;
}): Promise<PreparedGuestWaiver> {
  const evidenceKey = crypto.randomUUID();

  if (params.waiverSignature) {
    const signer = resolveWaiverSignerIdentity({
      signerNameInput: params.waiverSignature.signerName,
      signerEmailInput: params.waiverSignature.signerEmail,
      guestName: params.anonymousData.name,
      guestEmail: params.anonymousData.email,
      isSessionActor: false,
    });

    if (!signer) {
      return {
        error: "Signer email is required for the waiver.",
        evidencePaths: [],
      };
    }

    const prepared = await prepareWaiverSignatureRecord({
      projectId: params.projectId,
      evidenceKey,
      signerName: signer.signerName,
      signerEmail: signer.signerEmail,
      waiverSignature: params.waiverSignature,
    });

    return "error" in prepared
      ? { error: prepared.error, evidencePaths: prepared.uploadedPaths }
      : { record: prepared.record, evidencePaths: prepared.uploadedPaths };
  }

  if (params.reuseAnonymousId) {
    const prepared = await prepareClonedAnonymousWaiverRecord({
      projectId: params.projectId,
      anonymousId: params.reuseAnonymousId,
      evidenceKey,
    });

    return "error" in prepared
      ? { error: prepared.error, evidencePaths: prepared.uploadedPaths }
      : { record: prepared.record, evidencePaths: prepared.uploadedPaths };
  }

  return { record: null, evidencePaths: [] };
}

type AdminClient = ReturnType<typeof getAdminClient>;

export async function registerAnonymousSignup({
  serviceSupabase,
  anonymousData,
  project,
  projectId,
  scheduleId,
  volunteerComment,
  waiverSignature,
  formData,
  traceId,
  requestedSkipConfirmationEmail,
  selectedSlotCount,
  confirmationRequired,
}: {
  serviceSupabase: AdminClient;
  anonymousData: AnonymousSignupData;
  project: Project;
  projectId: string;
  scheduleId: string;
  volunteerComment: string | null;
  waiverSignature?: WaiverSignatureInput | null;
  formData?: Record<string, unknown>;
  traceId: string;
  requestedSkipConfirmationEmail: boolean;
  selectedSlotCount: number;
  confirmationRequired: boolean;
}) {
  const emailToCheck = (anonymousData.email ?? "").toLowerCase();
  const isSignupOnlyProject = project.verification_method === "signup-only";
  let createdSignupId: string | undefined;
  let createdAnonymousSignupId: string | null = null;
  let shouldReuseExistingAnonymousWaiver = false;
  let anonymousProfileAlreadyConfirmed = false;

  logSignupDebug(traceId, "anonymous_flow_start", {
    hasEmail: Boolean(emailToCheck),
    hasExistingSelectedSlotCount: Boolean(anonymousData.selectedSlotCount),
    skipConfirmationEmail: requestedSkipConfirmationEmail,
    isSignupOnlyProject,
  });

  const { data: existingAnonProfile, error: anonLookupError } =
    await serviceSupabase
      .from("anonymous_signups")
      .select("id, confirmed_at, token")
      .eq("project_id", projectId)
      .ilike("email", emailToCheck)
      .maybeSingle();

  if (anonLookupError) {
    logSignupDebug(traceId, "anonymous_lookup_failed", {
      error: summarizePostgrestError(anonLookupError),
    });
    return {
      response: { error: "An error occurred while checking signup status." },
    };
  }

  logSignupDebug(traceId, "anonymous_lookup_complete", {
    hasExistingAnonProfile: Boolean(existingAnonProfile),
    existingAnonConfirmed: Boolean(existingAnonProfile?.confirmed_at),
  });

  const hasContinuationCapability = existingAnonProfile
    ? verifyAnonymousSignupContinuation(anonymousData.continuationToken, {
        anonymousSignupId: existingAnonProfile.id,
        projectId,
        email: emailToCheck,
      })
    : false;
  const skipConfirmationForThisRequest =
    requestedSkipConfirmationEmail && hasContinuationCapability;

  if (!hasContinuationCapability) {
    const captchaValidation = await validateAnonymousSignupCaptcha(
      anonymousData.captchaToken,
    );
    if ("error" in captchaValidation) {
      return { response: { error: captchaValidation.error } };
    }
  }

  const { data: emailExists, error: rpcError } = await serviceSupabase.rpc(
    "check_email_exists",
    { email_to_check: emailToCheck },
  );

  if (rpcError) {
    logSignupDebug(traceId, "anonymous_email_exists_rpc_failed", {
      error: summarizePostgrestError(rpcError),
    });
    return {
      response: {
        error: "An error occurred while checking email availability.",
      },
    };
  }

  if (emailExists) {
    logSignupDebug(traceId, "blocked_email_has_account");
    return {
      response: {
        error:
          "This email is associated with an existing Let's Assist account. Please log in to sign up for this project.",
      },
    };
  }

  if (existingAnonProfile) {
    const { data: existingSlotSignup, error: slotError } = await serviceSupabase
      .from("project_signups")
      .select("id, status")
      .eq("project_id", projectId)
      .eq("schedule_id", scheduleId)
      .eq("anonymous_id", existingAnonProfile.id)
      .maybeSingle();

    if (slotError) {
      logSignupDebug(traceId, "anonymous_existing_slot_lookup_failed", {
        error: summarizePostgrestError(slotError),
      });
      return {
        response: { error: "An error occurred while checking signup status." },
      };
    }

    if (existingSlotSignup) {
      const signupStatus = existingSlotSignup.status;
      logSignupDebug(traceId, "anonymous_existing_slot_found", {
        existingSignupId: existingSlotSignup.id,
        signupStatus,
      });

      if (!confirmationRequired && signupStatus === "pending") {
        const confirmation = await confirmAnonymousSignupWithCapacity(
          existingAnonProfile.id,
        );
        if (confirmation.error || !confirmation.data) {
          logSignupDebug(traceId, "anonymous_atomic_confirmation_failed", {
            error: summarizePostgrestError(confirmation.error),
          });
          return {
            response: {
              error: "Failed to confirm this signup. Please try again.",
            },
          };
        }
        if (confirmation.data.outcome === "slot_full") {
          return {
            response: {
              error: "This slot just filled up. Please choose another time.",
            },
          };
        }
        if (
          confirmation.data.outcome !== "confirmed" &&
          confirmation.data.outcome !== "already_confirmed"
        ) {
          return {
            response: { error: "This signup can no longer be confirmed." },
          };
        }

        return {
          response: {
            success: true,
            signupId: existingSlotSignup.id,
            anonymousSignupId: existingAnonProfile.id,
            message: "You're already on the signup list.",
          },
        };
      }

      if (signupStatus === "pending") {
        return {
          response: {
            error:
              "You've already signed up for this slot but haven't confirmed your email yet.",
            canResend: true,
            anonymousSignupId: existingAnonProfile.id,
          },
        };
      }
      if (signupStatus === "approved") {
        return {
          response: {
            error:
              "This email has already signed up and confirmed for this slot.",
          },
        };
      }
      if (signupStatus === "rejected") {
        return {
          response: {
            error:
              "This email has been rejected by the project coordinator. Contact them for more details.",
          },
        };
      }
    }

    if (project.waiver_required && !waiverSignature) {
      if (!hasContinuationCapability) {
        return {
          response: {
            error:
              "This project requires a new waiver signature before signing up.",
          },
        };
      }

      const { data: existingWaiver, error: existingWaiverError } =
        await serviceSupabase
          .from("waiver_signatures")
          .select("id")
          .eq("project_id", projectId)
          .eq("anonymous_id", existingAnonProfile.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

      if (existingWaiverError) {
        console.error(
          "Error checking existing anonymous waiver signature:",
          existingWaiverError,
        );
        return {
          response: {
            error:
              "Unable to verify existing waiver signature. Please try again.",
          },
        };
      }
      if (!existingWaiver) {
        return {
          response: {
            error:
              "This project requires a waiver signature before signing up.",
          },
        };
      }
      shouldReuseExistingAnonymousWaiver = true;
    }

    createdAnonymousSignupId = existingAnonProfile.id;
    const isProfileConfirmed =
      (hasContinuationCapability && !!existingAnonProfile.confirmed_at) ||
      !confirmationRequired;
    anonymousProfileAlreadyConfirmed = isProfileConfirmed;
    const newSignupStatus = isProfileConfirmed ? "approved" : "pending";

    const preparedWaiver = await prepareGuestWaiverEvidence({
      projectId,
      anonymousData,
      waiverSignature,
      reuseAnonymousId: shouldReuseExistingAnonymousWaiver
        ? existingAnonProfile.id
        : null,
    });

    if ("error" in preparedWaiver) {
      await releaseUncommittedWaiverEvidence(
        preparedWaiver.evidencePaths,
        traceId,
      );
      logSignupDebug(traceId, "anonymous_waiver_prepare_failed");
      return { response: { error: preparedWaiver.error } };
    }

    const projectSignupData: Omit<ProjectSignup, "id" | "created_at"> = {
      project_id: projectId,
      schedule_id: scheduleId,
      user_id: null,
      status: newSignupStatus,
      anonymous_id: createdAnonymousSignupId,
      volunteer_comment: volunteerComment,
      response_data: formData || null,
    };
    const { data: insertedProjectSignup, error: projectSignupInsertError } =
      await insertProjectSignupAtomically(projectSignupData, traceId, {
        waiver: preparedWaiver.record,
      });

    if (projectSignupInsertError || !insertedProjectSignup) {
      await releaseUncommittedWaiverEvidence(
        preparedWaiver.evidencePaths,
        traceId,
      );
      logSignupDebug(traceId, "anonymous_existing_profile_insert_failed", {
        error: summarizePostgrestError(projectSignupInsertError),
      });
      return {
        response: {
          error: getProjectSignupInsertErrorMessage(projectSignupInsertError),
        },
      };
    }
    createdSignupId = insertedProjectSignup.id;

    if (!confirmationRequired && !existingAnonProfile.confirmed_at) {
      await serviceSupabase
        .from("anonymous_signups")
        .update({ confirmed_at: new Date().toISOString() })
        .eq("id", existingAnonProfile.id);
    }

    if (
      isProfileConfirmed &&
      anonymousData.email &&
      !skipConfirmationForThisRequest &&
      confirmationRequired
    ) {
      const { date, timeRange, slotLabel } = getScheduleDetails(
        project,
        scheduleId,
      );
      const anonymousProfileUrl = `${siteUrl}/anonymous/${createdAnonymousSignupId}?token=${existingAnonProfile.token}`;
      try {
        await sendEmail({
          to: anonymousData.email,
          subject:
            selectedSlotCount > 1
              ? `You're signed up for ${selectedSlotCount} slots in ${project.title}`
              : `You're signed up for another slot in ${project.title}`,
          react: React.createElement(AnonymousSignupConfirmation, {
            confirmationUrl: anonymousProfileUrl,
            projectName: project.title,
            userName: anonymousData.name,
            anonymousProfileUrl,
            projectDate: date,
            projectTime: timeRange,
            slotLabel,
            selectedSlotCount,
          }),
          type: "transactional",
        });
      } catch (error) {
        console.error("Error sending slot addition email:", error);
      }
    } else if (
      !isProfileConfirmed &&
      anonymousData.email &&
      !skipConfirmationForThisRequest
    ) {
      const newToken = crypto.randomUUID();
      await serviceSupabase
        .from("anonymous_signups")
        .update({ token: newToken })
        .eq("id", createdAnonymousSignupId);
      const confirmationUrl = `${siteUrl}/anonymous/${createdAnonymousSignupId}/confirm?token=${newToken}`;
      const anonymousProfileUrl = `${siteUrl}/anonymous/${createdAnonymousSignupId}?token=${newToken}`;
      const { date, timeRange, slotLabel } = getScheduleDetails(
        project,
        scheduleId,
      );
      try {
        await sendEmail({
          to: anonymousData.email,
          subject: `Confirm your signup for ${project.title}`,
          react: React.createElement(AnonymousSignupConfirmation, {
            confirmationUrl,
            projectName: project.title,
            userName: anonymousData.name,
            anonymousProfileUrl,
            projectDate: date,
            projectTime: timeRange,
            slotLabel,
            selectedSlotCount,
          }),
          type: "transactional",
        });
      } catch (error) {
        console.error("Error sending confirmation email:", error);
      }
    }
  } else {
    if (project.waiver_required && !waiverSignature) {
      return {
        response: {
          error: "This project requires a waiver signature before signing up.",
        },
      };
    }

    const confirmationToken = crypto.randomUUID();

    const preparedWaiver = await prepareGuestWaiverEvidence({
      projectId,
      anonymousData,
      waiverSignature,
    });

    if ("error" in preparedWaiver) {
      await releaseUncommittedWaiverEvidence(
        preparedWaiver.evidencePaths,
        traceId,
      );
      logSignupDebug(traceId, "anonymous_waiver_prepare_failed");
      return { response: { error: preparedWaiver.error } };
    }

    const projectSignupData: Omit<ProjectSignup, "id" | "created_at"> = {
      project_id: projectId,
      schedule_id: scheduleId,
      user_id: null,
      status: confirmationRequired ? "pending" : "approved",
      anonymous_id: null,
      volunteer_comment: volunteerComment,
      response_data: formData || null,
    };
    // The guest profile is created by the same transaction as the signup and
    // the waiver, so a refusal leaves no identity, no seat, and no evidence.
    const { data: insertedProjectSignup, error: projectSignupInsertError } =
      await insertProjectSignupAtomically(projectSignupData, traceId, {
        waiver: preparedWaiver.record,
        anonymousProfile: {
          email: anonymousData.email ?? "",
          name: anonymousData.name ?? null,
          phone_number: anonymousData.phone || null,
          token: confirmationToken,
          confirmed: !confirmationRequired,
        },
      });

    if (
      projectSignupInsertError ||
      !insertedProjectSignup ||
      !insertedProjectSignup.anonymousId
    ) {
      await releaseUncommittedWaiverEvidence(
        preparedWaiver.evidencePaths,
        traceId,
      );
      logSignupDebug(traceId, "anonymous_new_profile_signup_insert_failed", {
        error: summarizePostgrestError(projectSignupInsertError),
      });
      return {
        response: {
          error: getProjectSignupInsertErrorMessage(projectSignupInsertError),
        },
      };
    }
    createdSignupId = insertedProjectSignup.id;
    createdAnonymousSignupId = insertedProjectSignup.anonymousId;
    anonymousProfileAlreadyConfirmed = !confirmationRequired;
    logSignupDebug(traceId, "anonymous_profile_insert_success", {
      anonymousSignupId: createdAnonymousSignupId,
    });

    if (
      anonymousData.email &&
      confirmationToken &&
      createdAnonymousSignupId &&
      confirmationRequired
    ) {
      const confirmationUrl = `${siteUrl}/anonymous/${createdAnonymousSignupId}/confirm?token=${confirmationToken}`;
      const anonymousProfileUrl = `${siteUrl}/anonymous/${createdAnonymousSignupId}?token=${confirmationToken}`;
      const { date, timeRange, slotLabel } = getScheduleDetails(
        project,
        scheduleId,
      );
      try {
        const { data, error: emailError } = await sendEmail({
          to: anonymousData.email,
          subject: `Confirm your signup for ${project.title}`,
          react: React.createElement(AnonymousSignupConfirmation, {
            confirmationUrl,
            projectName: project.title,
            userName: anonymousData.name,
            anonymousProfileUrl,
            projectDate: date,
            projectTime: timeRange,
            slotLabel,
            selectedSlotCount,
          }),
          type: "transactional",
        });
        if (emailError) console.error("Resend error:", emailError);
        else console.log("Confirmation email sent successfully:", data);
      } catch (error) {
        console.error("Error sending confirmation email:", error);
      }
    }
  }

  return {
    createdSignupId,
    createdAnonymousSignupId,
    shouldReuseExistingAnonymousWaiver,
    anonymousProfileAlreadyConfirmed,
  };
}
