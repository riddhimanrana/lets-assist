"use server";

import { Resend } from "resend";
import { checkSuperAdmin } from "../actions";

const SUPPORT_FROM_FALLBACK = "Let's Assist Support <support@lets-assist.com>";

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  return new Resend(apiKey);
}

async function ensureAdmin() {
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" } as const;
  }
  return null;
}

type ListOptions = {
  limit?: number;
  after?: string;
  before?: string;
};

type PaginationOptions =
  | { limit?: number; after?: string; before?: never }
  | { limit?: number; before?: string; after?: never }
  | { limit?: number };

function buildPaginationOptions(options: ListOptions): PaginationOptions | undefined {
  const { limit, after, before } = options;

  if (after && before) {
    return { limit, after };
  }

  if (after) {
    return { limit, after };
  }

  if (before) {
    return { limit, before };
  }

  if (limit) {
    return { limit };
  }

  return undefined;
}

function normalizeListResponse<T>(
  data: { data?: T[]; has_more?: boolean } | T[] | null | undefined,
) {
  if (!data) {
    return { emails: [] as T[], hasMore: false };
  }

  if (Array.isArray(data)) {
    return { emails: data, hasMore: false };
  }

  return {
    emails: data.data ?? [],
    hasMore: Boolean(data.has_more),
  };
}

export async function listReceivedEmails(options: ListOptions = {}) {
  const authError = await ensureAdmin();
  if (authError) return authError;

  try {
    const resend = getResendClient();
    const { data, error } = await resend.emails.receiving.list(buildPaginationOptions(options));

    if (error) {
      return { error: error.message ?? "Failed to list received emails." };
    }

    const normalized = normalizeListResponse(data as { data?: unknown[]; has_more?: boolean } | unknown[] | null);
    return { data: normalized };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to list received emails." };
  }
}

export async function listSentEmails(options: ListOptions = {}) {
  const authError = await ensureAdmin();
  if (authError) return authError;

  try {
    const resend = getResendClient();
    const { data, error } = await resend.emails.list(buildPaginationOptions(options));

    if (error) {
      return { error: error.message ?? "Failed to list sent emails." };
    }

    const normalized = normalizeListResponse(data as { data?: unknown[]; has_more?: boolean } | unknown[] | null);
    return { data: normalized };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to list sent emails." };
  }
}

export async function getReceivedEmailDetails(emailId: string) {
  const authError = await ensureAdmin();
  if (authError) return authError;

  try {
    const resend = getResendClient();
    const { data: email, error } = await resend.emails.receiving.get(emailId);

    if (error) {
      return { error: error.message ?? "Failed to load received email." };
    }

    const { data: attachments, error: attachmentsError } = await resend.emails.receiving.attachments.list({
      emailId,
    });

    if (attachmentsError) {
      console.error("Resend attachments error:", attachmentsError);
    }

    const attachmentList = Array.isArray(attachments)
      ? attachments
      : attachments?.data ?? [];

    return { data: { email, attachments: attachmentList } };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load received email." };
  }
}

export async function getSentEmailDetails(emailId: string) {
  const authError = await ensureAdmin();
  if (authError) return authError;

  try {
    const resend = getResendClient();
    const { data: email, error } = await resend.emails.get(emailId);

    if (error) {
      return { error: error.message ?? "Failed to load sent email." };
    }

    const { data: attachments, error: attachmentsError } = await resend.emails.attachments.list({
      emailId,
    });

    if (attachmentsError) {
      console.error("Resend attachments error:", attachmentsError);
    }

    const attachmentList = Array.isArray(attachments)
      ? attachments
      : attachments?.data ?? [];

    return { data: { email, attachments: attachmentList } };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load sent email." };
  }
}

type SendReplyInput = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  inReplyTo?: string;
  references?: string;
  cc?: string[];
  bcc?: string[];
  from?: string;
};

export async function sendSupportReply(input: SendReplyInput) {
  const authError = await ensureAdmin();
  if (authError) return authError;

  try {
    const resend = getResendClient();
    const from = input.from || process.env.RESEND_SUPPORT_FROM || SUPPORT_FROM_FALLBACK;
    const replyTo = process.env.RESEND_SUPPORT_REPLY_TO;

    const headers: Record<string, string> = {};
    if (input.inReplyTo) {
      headers["In-Reply-To"] = input.inReplyTo;
    }
    if (input.references) {
      headers["References"] = input.references;
    }

    const { data, error } = await resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      cc: input.cc,
      bcc: input.bcc,
      headers: Object.keys(headers).length ? headers : undefined,
      replyTo: replyTo ? replyTo : undefined,
    });

    if (error) {
      return { error: error.message ?? "Failed to send reply." };
    }

    return { data };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to send reply." };
  }
}

type ForwardEmailInput = {
  emailId: string;
  to: string | string[];
  subject?: string;
  note?: string;
  includeAttachments?: boolean;
};

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatNoteHtml(note?: string) {
  if (!note) return "";
  const safe = escapeHtml(note).replace(/\n/g, "<br />");
  return `<p>${safe}</p><hr />`;
}

export async function forwardReceivedEmail(input: ForwardEmailInput) {
  const authError = await ensureAdmin();
  if (authError) return authError;

  try {
    const resend = getResendClient();
    const from = process.env.RESEND_SUPPORT_FROM || SUPPORT_FROM_FALLBACK;

    const { data: email, error } = await resend.emails.receiving.get(input.emailId);
    if (error) {
      return { error: error.message ?? "Failed to load received email." };
    }

    const { data: attachments, error: attachmentsError } = await resend.emails.receiving.attachments.list({
      emailId: input.emailId,
    });

    if (attachmentsError) {
      console.error("Resend attachments error:", attachmentsError);
    }

    const attachmentList = Array.isArray(attachments)
      ? attachments
      : attachments?.data ?? [];

    let forwardedAttachments: Array<{
      filename?: string;
      content?: string;
      contentType?: string;
      contentId?: string;
    }> = [];

    if (input.includeAttachments && attachmentList.length > 0) {
      const downloads = await Promise.all(
        attachmentList.map(async (attachment) => {
          if (!attachment?.download_url) return null;
          try {
            const response = await fetch(attachment.download_url);
            if (!response.ok) return null;
            const buffer = Buffer.from(await response.arrayBuffer());
            return {
              filename: attachment.filename,
              content: buffer.toString("base64"),
              contentType: attachment.content_type,
              contentId: attachment.content_id ?? undefined,
            };
          } catch (err) {
            console.error("Failed to download attachment", err);
            return null;
          }
        }),
      );

      forwardedAttachments = downloads.filter(Boolean) as typeof forwardedAttachments;
    }

    const noteHtml = formatNoteHtml(input.note);
    const htmlBody = `${noteHtml}${email?.html ?? ""}`;
    const textBody = `${input.note ? `${input.note}\n\n---\n` : ""}${email?.text ?? ""}`;

    const subject = input.subject || `Fwd: ${email?.subject ?? "Forwarded message"}`;

    const { data, error: sendError } = await resend.emails.send({
      from,
      to: input.to,
      subject,
      html: htmlBody,
      text: textBody,
      attachments: forwardedAttachments.length ? forwardedAttachments : undefined,
    });

    if (sendError) {
      return { error: sendError.message ?? "Failed to forward email." };
    }

    return { data };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to forward email." };
  }
}
