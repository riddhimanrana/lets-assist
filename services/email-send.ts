import { createClient } from "@/lib/supabase/server";
import { render } from "react-email";
import { logError, logInfo, logWarn } from "@/lib/logger";
import {
  classifyProviderError,
  emailLogAttributes,
  getResendClient,
  safeLogToken,
  sendViaMailpit,
  shouldUseMailpitTransport,
  type SendEmailParams,
  type SendEmailResult,
} from "./email";

export async function sendEmail({
  to,
  subject,
  html,
  text,
  react,
  userId,
  type,
  attachments,
  from,
  replyTo,
  tags,
  headers,
  topicId,
  idempotencyKey,
  signal,
}: SendEmailParams): Promise<SendEmailResult> {
  const shouldLog = process.env.NODE_ENV !== "test";
  const safeLogAttributes = emailLogAttributes({ to, type, userId });

  // Require at least one supported representation. Transactional callers
  // should normally provide both HTML and plain text, while small operational
  // notices may intentionally be text-only.
  if (!html && !react && !text) {
    if (shouldLog) {
      logError(
        "Email validation failed: No message body provided",
        new Error("Invalid email parameters"),
        {
          ...safeLogAttributes,
          reason: "missing_body",
        },
      );
    }
    return {
      outcome: "definitive_failure",
      success: false,
      skipped: false,
      phase: "local_validation",
      code: "missing_body",
      status: null,
      error: "At least one of html, react, or text must be provided",
    };
  }

  // 1. Check preferences if userId is provided and type is not transactional
  if (userId && type !== "transactional") {
    const supabase = await createClient();

    // Fetch user's notification settings
    const { data: settings, error } = await supabase
      .from("notification_settings")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (error && error.code !== "PGRST116") {
      if (shouldLog) {
        logError(
          "Failed to fetch notification settings",
          new Error("Notification settings query failed"),
          {
            ...safeLogAttributes,
            error_code: safeLogToken(error.code),
          },
        );
      }
      // If error fetching settings, default to sending (fail open) or skipping?
      // Safest to probably send if it's important, but let's log it.
    }

    if (settings) {
      // Check global email switch
      if (settings.email_notifications === false) {
        if (shouldLog) {
          logInfo("Email skipped due to user preferences", {
            ...safeLogAttributes,
            reason: "global_email_disabled",
          });
        }
        return {
          outcome: "skipped",
          success: false,
          skipped: true,
          phase: "preference_check",
          code: "global_email_disabled",
          reason: "Global email notifications disabled",
        };
      }

      // Check specific type switch
      // Assuming the column names match the EmailType (except transactional)
      if (type === "project_updates" && settings.project_updates === false) {
        if (shouldLog) {
          logInfo("Email skipped due to user preferences", {
            ...safeLogAttributes,
            reason: "project_updates_disabled",
          });
        }
        return {
          outcome: "skipped",
          success: false,
          skipped: true,
          phase: "preference_check",
          code: "project_updates_disabled",
          reason: "Project updates disabled",
        };
      }

      if (type === "general" && settings.general === false) {
        if (shouldLog) {
          logInfo("Email skipped due to user preferences", {
            ...safeLogAttributes,
            reason: "general_notifications_disabled",
          });
        }
        return {
          outcome: "skipped",
          success: false,
          skipped: true,
          phase: "preference_check",
          code: "general_notifications_disabled",
          reason: "General notifications disabled",
        };
      }
    }
  }

  // 2. RENDERING IS LOCAL WORK, NOT A PROVIDER REQUEST.
  //
  // This used to sit inside the same try/catch that classifies transport faults,
  // so a React component that threw -- a missing prop, a bad date, a template bug
  // -- came back as `unknown_outcome`. That is the one classification that means
  // "a real person may already have been mailed", and it made the CSF ledger mark
  // the attempt unretryable and demand human reconciliation for a message that
  // provably never left the process. Rendering gets its own boundary.
  let emailHtml: string | undefined;
  try {
    emailHtml = react ? await render(react) : html;
  } catch (error) {
    if (shouldLog) {
      logError("Email render failed", new Error("Email render failed"), {
        ...safeLogAttributes,
        error_kind: safeLogToken(
          error instanceof Error ? error.name : undefined,
        ),
        outcome: "definitive_failure",
        phase: "local_validation",
      });
    }
    return {
      outcome: "definitive_failure",
      success: false,
      skipped: false,
      phase: "local_validation",
      code: "render_failed",
      status: null,
      error: "the message could not be rendered",
    };
  }

  if (!emailHtml && !text) {
    // A React element that rendered to nothing leaves no representation at all.
    return {
      outcome: "definitive_failure",
      success: false,
      skipped: false,
      phase: "local_validation",
      code: "empty_rendered_body",
      status: null,
      error: "the rendered message had no content",
    };
  }

  // 3. Transport selection, also outside the ambiguity boundary.
  if (shouldUseMailpitTransport()) {
    const mailpitResult = await sendViaMailpit({
      to,
      subject,
      html: emailHtml,
      text,
      attachments,
      from,
      replyTo,
      tags,
      headers,
      topicId,
      idempotencyKey,
    });

    if (shouldLog && mailpitResult.outcome === "accepted") {
      logInfo("Email delivered via local Mailpit transport", {
        ...safeLogAttributes,
        transport: "mailpit",
      });
    }

    return mailpitResult;
  }

  const setup = getResendClient();

  if (!setup.ok && !setup.configured) {
    if (shouldLog) {
      logWarn(
        "Email transport unavailable (set EMAIL_TRANSPORT=mailpit locally or configure RESEND_API_KEY)",
        {
          ...safeLogAttributes,
          transport: "resend",
        },
      );
    }
    return {
      outcome: "skipped",
      success: false,
      skipped: true,
      phase: "transport_setup",
      code: "transport_not_configured",
      reason: "Email service not configured",
    };
  }

  if (!setup.ok) {
    // Configured but unusable. Distinct from "not configured": somebody meant to
    // send, so this is an operational fault to surface and retry, not a skip.
    if (shouldLog) {
      logError(
        "Email provider client could not be constructed",
        new Error("Email transport setup failed"),
        {
          ...safeLogAttributes,
          transport: "resend",
          outcome: "retryable_pre_send",
          phase: "transport_setup",
        },
      );
    }
    return {
      outcome: "retryable_pre_send",
      success: false,
      skipped: false,
      phase: "transport_setup",
      code: setup.code,
      status: null,
      error: "the provider client could not be constructed",
    };
  }

  const resend = setup.client;

  // 4. THE PROVIDER REQUEST. Everything inside this try may have reached Resend.
  try {
    const content = emailHtml
      ? { html: emailHtml, ...(text ? { text } : {}) }
      : { text: text! };
    // The installed SDK forwards all request options to `fetch`; its published
    // type currently names idempotency only, while the Fetch-standard signal is
    // intentionally local to this call. Keeping it in the request-options object
    // means it is never serialized into the provider payload or its ledger hash.
    const requestOptions = {
      ...(idempotencyKey ? { idempotencyKey } : {}),
      ...(signal ? { signal } : {}),
    };
    const { data, error } = await resend.emails.send(
      {
        from:
          from ??
          process.env.EMAIL_FROM?.trim() ??
          "Let's Assist <projects@notifications.lets-assist.com>",
        to,
        subject,
        ...content,
        replyTo,
        tags,
        // Spread rather than always-present so a caller that supplies no
        // headers sends the exact same request shape it always did.
        ...(headers ? { headers } : {}),
        // Same reasoning, and it matters more here: the SDK forwards this to the
        // API as `topic_id`, so a present-but-null key would reach the provider
        // and diverge from the request the CSF digest was computed over.
        ...(topicId ? { topicId } : {}),
        attachments,
      },
      Object.keys(requestOptions).length > 0 ? requestOptions : undefined,
    );

    // THE API ANSWERED, SO THE REQUEST AROSE -- ONLY ACCEPTANCE IS IN QUESTION.
    //
    // Reaching this branch means Resend evaluated the request and returned a
    // structured error, which is a completely different situation from a socket
    // that died. Classification decides whether a retry is safe; see
    // PROVIDER_ERROR_CLASSIFICATION.
    if (error) {
      const classified = classifyProviderError(error);
      if (shouldLog) {
        logError(
          "Failed to send email via Resend",
          new Error("Email provider request failed"),
          {
            ...safeLogAttributes,
            provider_error: safeLogToken(classified.code),
            outcome: classified.outcome,
            phase: classified.phase,
          },
        );
      }
      return classified;
    }

    if (!data?.id) {
      // A 2xx with no message identity means we cannot name what was sent, and
      // the provider may well have accepted it. That is precisely an unknown
      // outcome, not a success.
      if (shouldLog) {
        logWarn(
          "Resend accepted an email without returning a message identity",
          {
            ...safeLogAttributes,
            outcome: "unknown_outcome",
          },
        );
      }
      return {
        outcome: "unknown_outcome",
        success: false,
        skipped: false,
        phase: "provider_response",
        code: "missing_provider_message_id",
        status: null,
        error: "provider accepted the request without naming a message",
      };
    }

    return {
      outcome: "accepted",
      success: true,
      skipped: false,
      phase: "provider_response",
      messageId: data.id,
      transport: "resend",
      data,
    };
  } catch (error) {
    // THE REQUEST BOUNDARY, AND THE WHOLE REASON THIS UNION EXISTS.
    //
    // Control left this process inside resend.emails.send(). A throw from there
    // is a timeout, a connection reset, a DNS failure, or an aborted socket --
    // and NONE of those tell us whether the request reached Resend and was
    // accepted before the connection died. The old code reported this
    // identically to a validation rejection, so any caller that retried
    // failures would re-send messages Resend had already queued.
    //
    // It is therefore an unknown outcome. Never an automatic retry.
    if (shouldLog) {
      logError(
        "Exception while sending email",
        new Error("Email transport failed"),
        {
          ...safeLogAttributes,
          error_kind: safeLogToken(
            error instanceof Error ? error.name : undefined,
          ),
          outcome: "unknown_outcome",
          phase: "provider_request",
        },
      );
    }
    return {
      outcome: "unknown_outcome",
      success: false,
      skipped: false,
      phase: "provider_request",
      code: "transport_exception",
      status: null,
      error: "the provider request may or may not have been accepted",
    };
  }
}
