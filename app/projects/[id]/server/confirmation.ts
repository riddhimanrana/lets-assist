"use server";

import "server-only";
import { type Project } from "@/types";
import crypto from "crypto";
import { sendEmail, type SendEmailResult } from "@/services/email";
import AnonymousSignupConfirmation from "@/emails/anonymous-signup-confirmation";
import * as React from "react";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  getRequestMetadata,
  getScheduleDetails,
  siteUrl,
  validateAnonymousSignupCaptcha,
} from "./shared";

/**
 * Resend confirmation email for an anonymous signup
 * @param anonymousSignupId - The ID of the anonymous signup record
 * @returns Object with success or error message
 */
export async function resendAnonymousConfirmationEmail(
  anonymousSignupId: string,
  captchaToken?: string,
): Promise<{ success?: boolean; error?: string }> {
  "use server";
  try {
    const captchaValidation = await validateAnonymousSignupCaptcha(
      captchaToken,
      "anonymous-confirmation",
    );

    if ("error" in captchaValidation) {
      return { error: captchaValidation.error };
    }

    const admin = getAdminClient();
    const { ipAddress } = await getRequestMetadata();
    const rateLimitKey = crypto
      .createHash("sha256")
      .update(`${anonymousSignupId}:${ipAddress ?? "unknown"}`)
      .digest("hex");
    const { data: rateLimitData, error: rateLimitError } = await admin.rpc(
      "consume_api_rate_limit",
      {
        p_key: `anonymous-confirmation:${rateLimitKey}`,
        p_limit: 1,
        p_window_seconds: 60,
      },
    );
    const rateLimit = Array.isArray(rateLimitData)
      ? rateLimitData[0]
      : rateLimitData;

    if (rateLimitError || !rateLimit?.allowed) {
      return {
        error: "Please wait before requesting another confirmation email.",
      };
    }

    const { data: anonSignup, error: fetchError } = await admin
      .from("anonymous_signups")
      .select("id, email, name, project_id, confirmed_at, token, created_at")
      .eq("id", anonymousSignupId)
      .maybeSingle();

    if (fetchError) {
      console.error("Error fetching anonymous signup:", fetchError);
      return { error: "Unable to resend the confirmation email." };
    }

    // Keep the public response non-enumerating for missing/already-confirmed IDs.
    if (!anonSignup || anonSignup.confirmed_at) {
      return { success: true };
    }

    // Get project title for the email
    const { data: project, error: projectError } = await admin
      .from("projects")
      .select("title, event_type, schedule")
      .eq("id", anonSignup.project_id)
      .single();

    if (projectError || !project) {
      console.error("Error fetching project:", projectError);
      return { error: "Failed to fetch project details." };
    }

    // Generate a new confirmation token for security (invalidates old links)
    const newToken = crypto.randomUUID();

    // Update the token in the database
    const { data: updatedSignup, error: updateError } = await admin
      .from("anonymous_signups")
      .update({ token: newToken })
      .eq("id", anonymousSignupId)
      .eq("token", anonSignup.token)
      .is("confirmed_at", null)
      .select("id")
      .maybeSingle();

    if (updateError || !updatedSignup) {
      return { error: "Failed to generate new confirmation link." };
    }

    // Send the confirmation email
    const confirmationUrl = `${siteUrl}/anonymous/${anonymousSignupId}/confirm?token=${newToken}`;
    const anonymousProfileUrl = `${siteUrl}/anonymous/${anonymousSignupId}?token=${newToken}`;

    const { data: signupRecord } = await admin
      .from("project_signups")
      .select("schedule_id")
      .eq("anonymous_id", anonymousSignupId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const scheduleId = signupRecord?.schedule_id;
    const scheduleDetails = scheduleId
      ? getScheduleDetails(project as Project, scheduleId)
      : { date: "TBD", time: "TBD", timeRange: "TBD", slotLabel: "TBD" };

    const restorePreviousToken = async () => {
      await admin
        .from("anonymous_signups")
        .update({ token: anonSignup.token })
        .eq("id", anonymousSignupId)
        .eq("token", newToken);
    };

    let delivery: SendEmailResult;
    try {
      delivery = await sendEmail({
        to: anonSignup.email,
        subject: `Confirm your signup for ${project.title}`,
        react: React.createElement(AnonymousSignupConfirmation, {
          confirmationUrl,
          projectName: project.title,
          userName: anonSignup.name,
          anonymousProfileUrl,
          projectDate: scheduleDetails.date,
          projectTime: scheduleDetails.timeRange,
          slotLabel: scheduleDetails.slotLabel,
        }),
        type: "transactional",
        idempotencyKey: `anonymous-confirmation/${anonymousSignupId}/${newToken}`,
      });
    } catch {
      // The request may have reached the provider. Keep the new link valid.
      return {
        error:
          "Delivery could not be confirmed. Check your inbox before requesting another email.",
      };
    }

    if (delivery.outcome === "unknown_outcome") {
      return {
        error:
          "Delivery could not be confirmed. Check your inbox before requesting another email.",
      };
    }
    if (delivery.outcome !== "accepted") {
      await restorePreviousToken();
      return { error: "Failed to send confirmation email. Please try again." };
    }

    return { success: true };
  } catch (error) {
    console.error("Error in resendAnonymousConfirmationEmail:", error);
    return { error: "An unexpected error occurred." };
  }
}
