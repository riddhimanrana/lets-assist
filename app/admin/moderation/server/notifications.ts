import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import { NotificationService } from "@/services/notifications";
import { sendEmail } from "@/services/email";
import ContentModerationActionEmail from "@/emails/content-moderation-action";
import ReportStatusUpdateEmail from "@/emails/report-status-update";

type ModerationAction =
  | "warn_user"
  | "remove_content"
  | "block_content"
  | "dismiss"
  | "escalate_to_legal";

type ContentOwnerInfo = {
  userId: string;
  userName: string;
  userEmail?: string | null;
  contentTitle: string;
  contentTypeLabel: string;
  contentUrl?: string;
};

function formatContentTypeLabel(contentType: string) {
  switch (contentType) {
    case "project":
      return "project";
    case "profile":
      return "profile";
    case "organization":
      return "organization";
    default:
      return "content";
  }
}

async function fetchAuthUserEmail(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
) {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) {
    console.error("Error fetching auth user email:", error);
    return null;
  }
  return data?.user?.email ?? null;
}

async function resolveContentOwnerInfo(
  supabase: ReturnType<typeof getAdminClient>,
  contentType: string,
  contentId: string,
): Promise<ContentOwnerInfo | null> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://lets-assist.com";

  if (contentType === "project") {
    const { data: project } = await supabase
      .from("projects")
      .select("id, title, creator_id")
      .eq("id", contentId)
      .maybeSingle();

    if (!project?.creator_id) return null;

    const { data: creator } = await supabase
      .from("profiles")
      .select("id, full_name, username, email")
      .eq("id", project.creator_id)
      .maybeSingle();

    const userEmail =
      creator?.email ||
      (await fetchAuthUserEmail(supabase, project.creator_id));
    const userName = creator?.full_name || creator?.username || "there";

    return {
      userId: project.creator_id,
      userName,
      userEmail,
      contentTitle: project.title || "Untitled project",
      contentTypeLabel: "project",
      contentUrl: `${baseUrl}/projects/${contentId}`,
    };
  }

  if (contentType === "profile") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, full_name, username, email")
      .eq("id", contentId)
      .maybeSingle();

    if (!profile) return null;
    const userEmail =
      profile.email || (await fetchAuthUserEmail(supabase, contentId));
    const userName = profile.full_name || profile.username || "there";
    const profileSlug = profile.username || contentId;

    return {
      userId: contentId,
      userName,
      userEmail,
      contentTitle: profile.full_name || profile.username || "Your profile",
      contentTypeLabel: "profile",
      contentUrl: `${baseUrl}/profile/${profileSlug}`,
    };
  }

  if (contentType === "organization") {
    const { data: org } = await supabase
      .from("organizations")
      .select("id, name, username, created_by")
      .eq("id", contentId)
      .maybeSingle();

    if (!org?.created_by) return null;

    const { data: creator } = await supabase
      .from("profiles")
      .select("id, full_name, username, email")
      .eq("id", org.created_by)
      .maybeSingle();

    const userEmail =
      creator?.email || (await fetchAuthUserEmail(supabase, org.created_by));
    const userName = creator?.full_name || creator?.username || "there";
    const orgSlug = org.username || contentId;

    return {
      userId: org.created_by,
      userName,
      userEmail,
      contentTitle: org.name || "Organization",
      contentTypeLabel: "organization",
      contentUrl: `${baseUrl}/organization/${orgSlug}`,
    };
  }

  return null;
}

function buildModerationCopy(
  action: ModerationAction,
  contentTypeLabel: string,
  contentTitle: string,
  reason?: string,
) {
  const safeReason = reason ? `Reason: ${reason}` : "Reason: Policy violation.";
  const baseTitle = `Update on your ${contentTypeLabel}`;

  switch (action) {
    case "remove_content":
      return {
        title: baseTitle,
        body: `We removed your ${contentTypeLabel} “${contentTitle}”. ${safeReason}`,
        emailSubject: `Your ${contentTypeLabel} was removed`,
        actionLabel: "removed",
      };
    case "block_content":
      return {
        title: baseTitle,
        body: `We blocked your ${contentTypeLabel} “${contentTitle}”. ${safeReason}`,
        emailSubject: `Your ${contentTypeLabel} was blocked`,
        actionLabel: "blocked",
      };
    case "warn_user":
      return {
        title: baseTitle,
        body: `We issued a warning about your ${contentTypeLabel} “${contentTitle}”. ${safeReason}`,
        emailSubject: `Warning about your ${contentTypeLabel}`,
        actionLabel: "issued a warning about",
      };
    default:
      return {
        title: baseTitle,
        body: `We reviewed your ${contentTypeLabel} “${contentTitle}”. ${safeReason}`,
        emailSubject: `Update on your ${contentTypeLabel}`,
        actionLabel: "updated",
      };
  }
}

async function shouldSendGeneralNotification(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
) {
  const { data, error } = await supabase
    .from("notification_settings")
    .select("general")
    .eq("user_id", userId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("Error checking notification settings:", error);
    return true;
  }

  return data?.general !== false;
}

export async function notifyContentOwnerOfModeration({
  supabase,
  contentType,
  contentId,
  action,
  reason,
}: {
  supabase: ReturnType<typeof getAdminClient>;
  contentType: string;
  contentId: string;
  action: ModerationAction;
  reason?: string;
}) {
  const owner = await resolveContentOwnerInfo(supabase, contentType, contentId);
  if (!owner) {
    return;
  }

  const { title, body, emailSubject, actionLabel } = buildModerationCopy(
    action,
    formatContentTypeLabel(owner.contentTypeLabel),
    owner.contentTitle,
    reason,
  );

  const shouldNotify = await shouldSendGeneralNotification(
    supabase,
    owner.userId,
  );

  if (shouldNotify) {
    const { error: notificationError } = await supabase
      .from("notifications")
      .insert({
        user_id: owner.userId,
        title,
        body,
        type: "general",
        severity: "warning",
        action_url: owner.contentUrl,
        displayed: false,
        read: false,
        data: {
          kind: "moderation_action",
          action,
          contentType,
          contentId,
        },
      });

    if (notificationError) {
      console.error(
        "Error creating moderation notification:",
        notificationError,
      );
    }
  }

  if (owner.userEmail) {
    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL || "https://lets-assist.com";
    await sendEmail({
      to: owner.userEmail,
      subject: emailSubject,
      react: ContentModerationActionEmail({
        userName: owner.userName,
        contentTitle: owner.contentTitle,
        contentTypeLabel: owner.contentTypeLabel,
        actionLabel,
        reason,
        contentUrl: owner.contentUrl,
        supportUrl: `${baseUrl}/help`,
      }),
      userId: owner.userId,
      type: "transactional",
    });
  }
}

async function resolveReportContentSummary(
  supabase: ReturnType<typeof getAdminClient>,
  contentType: string,
  contentId: string,
) {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://lets-assist.com";

  if (contentType === "project") {
    const { data: project } = await supabase
      .from("projects")
      .select("id, title")
      .eq("id", contentId)
      .maybeSingle();

    return {
      title: project?.title || "Reported project",
      url: `${baseUrl}/projects/${contentId}`,
      contentTypeLabel: "project",
    };
  }

  if (contentType === "profile") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, full_name, username")
      .eq("id", contentId)
      .maybeSingle();

    const profileSlug = profile?.username || contentId;

    return {
      title: profile?.full_name || profile?.username || "Reported profile",
      url: `${baseUrl}/profile/${profileSlug}`,
      contentTypeLabel: "profile",
    };
  }

  if (contentType === "organization") {
    const { data: organization } = await supabase
      .from("organizations")
      .select("id, name, username")
      .eq("id", contentId)
      .maybeSingle();

    const orgSlug = organization?.username || contentId;

    return {
      title: organization?.name || "Reported organization",
      url: `${baseUrl}/organization/${orgSlug}`,
      contentTypeLabel: "organization",
    };
  }

  return {
    title: "Reported content",
    url: `${baseUrl}`,
    contentTypeLabel: formatContentTypeLabel(contentType),
  };
}

export async function notifyReporterOfReportUpdate({
  supabase,
  report,
  status,
  resolutionNotes,
}: {
  supabase: ReturnType<typeof getAdminClient>;
  report: {
    id: string;
    reporter_id?: string | null;
    reason?: string | null;
    content_type?: string | null;
    content_id?: string | null;
  };
  status: "resolved" | "dismissed";
  resolutionNotes?: string;
}) {
  const reporterId = report.reporter_id;
  if (!reporterId) return;

  const { data: reporter } = await supabase
    .from("profiles")
    .select("id, full_name, username, email")
    .eq("id", reporterId)
    .maybeSingle();

  const reporterName = reporter?.full_name || reporter?.username || "there";
  const reporterEmail =
    reporter?.email || (await fetchAuthUserEmail(supabase, reporterId));

  const resolvedStatusLabel = status === "resolved" ? "resolved" : "dismissed";
  const contentSummary = await resolveReportContentSummary(
    supabase,
    report.content_type || "content",
    report.content_id || "",
  );

  const notificationBody =
    status === "resolved"
      ? `Your report about ${contentSummary.contentTypeLabel} “${contentSummary.title}” has been resolved.`
      : `Your report about ${contentSummary.contentTypeLabel} “${contentSummary.title}” was dismissed after review.`;

  await NotificationService.createNotification(
    {
      title: "Update on your report",
      body: notificationBody,
      type: "general",
      severity: "info",
      actionUrl: contentSummary.url,
      data: {
        kind: "moderation_report_update",
        reportId: report.id,
        status: resolvedStatusLabel,
        reason: report.reason,
        notes: resolutionNotes,
      },
    },
    reporterId,
  );

  if (reporterEmail) {
    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL || "https://lets-assist.com";
    await sendEmail({
      to: reporterEmail,
      subject:
        status === "resolved"
          ? "Your report has been resolved"
          : "Update on your submitted report",
      react: ReportStatusUpdateEmail({
        userName: reporterName,
        reportStatus: resolvedStatusLabel,
        reportReason: report.reason || "No reason provided",
        moderationNotes: resolutionNotes,
        contentTitle: contentSummary.title,
        contentTypeLabel: contentSummary.contentTypeLabel,
        contentUrl: contentSummary.url,
        supportUrl: `${baseUrl}/help`,
      }),
      userId: reporterId,
      type: "general",
    });
  }
}
