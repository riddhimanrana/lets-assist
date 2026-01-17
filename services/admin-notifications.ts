import { getServiceRoleClient } from "@/utils/supabase/service-role";

type NotificationSeverity = "info" | "warning" | "success";

type AdminBatchEvent =
  | {
      type: "trusted_member_application";
      applicationId: string;
      applicantName: string;
      applicantEmail: string;
      submittedAt?: string;
    }
  | {
      type: "content_report";
      reportId: string;
      reason: string;
      contentType: string;
      priority: "high" | "normal" | "critical" | string;
      reportedAt?: string;
    }
  | {
      type: "flagged_content";
      contentId: string;
      contentType: string;
      flagType: string;
      confidenceScore?: number;
      flaggedAt?: string;
    };

type AdminNotificationData = {
  batchKey?: string;
  count?: number;
  items?: string[];
  latest?: string;
  firstEventAt?: string;
  lastEventAt?: string;
  lastEvent?: unknown;
  [key: string]: unknown;
};

const ADMIN_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_SAMPLE_ITEMS = 3;

const BATCH_WINDOWS_MINUTES: Record<AdminBatchEvent["type"], number> = {
  trusted_member_application: 60,
  content_report: 30,
  flagged_content: 30,
};

const SEVERITY_RANK: Record<NotificationSeverity, number> = {
  info: 1,
  success: 2,
  warning: 3,
};

let cachedAdminIds: string[] | null = null;
let cachedAdminIdsAt = 0;

async function getAdminUserIds() {
  const now = Date.now();
  if (cachedAdminIds && now - cachedAdminIdsAt < ADMIN_CACHE_TTL_MS) {
    return cachedAdminIds;
  }

  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (error) {
    console.error("Failed to fetch admin users:", error);
    return [];
  }

  const adminIds = (data?.users ?? [])
    .filter((user) =>
      (user as unknown as { is_super_admin?: boolean } | null)?.is_super_admin === true ||
      user?.user_metadata?.is_super_admin === true ||
      user?.app_metadata?.is_super_admin === true
    )
    .map((user) => user.id);

  cachedAdminIds = adminIds;
  cachedAdminIdsAt = now;
  return adminIds;
}

function pickHigherSeverity(a: NotificationSeverity, b: NotificationSeverity) {
  return SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a;
}

function formatBatchTitle(baseTitle: string, count: number) {
  return count > 1 ? `${baseTitle} (${count})` : baseTitle;
}

function buildTrustedMemberCopy(count: number, latestLabel: string, windowMinutes: number) {
  const title = formatBatchTitle("New trusted member applications", count);
  const body =
    count > 1
      ? `${count} new trusted member applications in the last ${windowMinutes} minutes. Latest: ${latestLabel}.`
      : `${latestLabel} has applied to become a trusted member. Please review their application.`;

  return {
    title,
    body,
    actionUrl: "/admin?tab=trusted-members",
    severity: "info" as NotificationSeverity,
  };
}

function buildReportCopy(
  count: number,
  latestLabel: string,
  windowMinutes: number,
  priority: string
) {
  const isHighPriority = priority === "high" || priority === "critical";
  const baseTitle = isHighPriority ? "High-priority user reports" : "New user reports";
  const body =
    count > 1
      ? `${count} ${isHighPriority ? "high-priority " : ""}reports in the last ${windowMinutes} minutes. Latest: ${latestLabel}.`
      : `${latestLabel} report submitted. Please review in the admin dashboard.`;

  return {
    title: formatBatchTitle(baseTitle, count),
    body,
    actionUrl: "/admin?tab=reports",
    severity: isHighPriority ? ("warning" as NotificationSeverity) : ("info" as NotificationSeverity),
  };
}

function buildFlaggedContentCopy(
  count: number,
  latestLabel: string,
  windowMinutes: number,
  confidenceScore?: number
) {
  const highConfidence = typeof confidenceScore === "number" && confidenceScore >= 0.8;
  const baseTitle = highConfidence ? "High-confidence content flags" : "New content flags";
  const body =
    count > 1
      ? `${count} content flags in the last ${windowMinutes} minutes. Latest: ${latestLabel}.`
      : `${latestLabel} has been flagged. Please review.`;

  return {
    title: formatBatchTitle(baseTitle, count),
    body,
    actionUrl: "/admin?tab=flagged",
    severity: highConfidence ? ("warning" as NotificationSeverity) : ("info" as NotificationSeverity),
  };
}

function buildBatchDetails(event: AdminBatchEvent, count: number, latestLabel: string) {
  const windowMinutes = BATCH_WINDOWS_MINUTES[event.type];

  switch (event.type) {
    case "trusted_member_application":
      return {
        batchKey: "trusted_member_application",
        windowMinutes,
        ...buildTrustedMemberCopy(count, latestLabel, windowMinutes),
      };
    case "content_report":
      return {
        batchKey: `content_report:${event.priority || "normal"}`,
        windowMinutes,
        ...buildReportCopy(count, latestLabel, windowMinutes, event.priority || "normal"),
      };
    case "flagged_content":
      return {
        batchKey: `flagged_content:${event.flagType || "general"}`,
        windowMinutes,
        ...buildFlaggedContentCopy(count, latestLabel, windowMinutes, event.confidenceScore),
      };
  }
}

function getEventLabel(event: AdminBatchEvent) {
  switch (event.type) {
    case "trusted_member_application":
      return `${event.applicantName} (${event.applicantEmail})`;
    case "content_report":
      return `${event.reason} (${event.contentType})`;
    case "flagged_content":
      return `${event.flagType} (${event.contentType})`;
  }
}

async function createOrUpdateBatchNotification(adminUserId: string, event: AdminBatchEvent) {
  const supabase = getServiceRoleClient();
  const latestLabel = getEventLabel(event);
  const { batchKey, windowMinutes, title, body, actionUrl, severity } = buildBatchDetails(
    event,
    1,
    latestLabel
  );

  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

  const { data: existing, error: existingError } = await supabase
    .from("notifications")
    .select("id, data, severity, created_at")
    .eq("user_id", adminUserId)
    .eq("type", "general")
    .eq("read", false)
    .gte("created_at", windowStart)
    .eq("data->>batchKey", batchKey)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    console.error("Error checking existing admin notifications:", existingError);
  }

  const nowIso = new Date().toISOString();
  const existingData = (existing?.data ?? {}) as AdminNotificationData;
  const currentCount = Number(existingData.count ?? (existing ? 1 : 0));
  const nextCount = currentCount + 1;
  const existingItems = Array.isArray(existingData.items) ? existingData.items : [];
  const nextItems =
    existingItems.length < MAX_SAMPLE_ITEMS ? [...existingItems, latestLabel] : existingItems;

  const copy = buildBatchDetails(event, nextCount, latestLabel);
  const nextSeverity = existing?.severity
    ? pickHigherSeverity(existing.severity as NotificationSeverity, severity)
    : severity;

  const dataPayload = {
    ...existingData,
    batchKey: copy.batchKey,
    count: nextCount,
    items: nextItems,
    latest: latestLabel,
    lastEventAt: nowIso,
    firstEventAt: existingData.firstEventAt ?? nowIso,
    lastEvent: {
      ...event,
      occurredAt: nowIso,
    },
  };

  if (existing?.id) {
    const { error: updateError } = await supabase
      .from("notifications")
      .update({
        title: copy.title,
        body: copy.body,
        severity: nextSeverity,
        action_url: copy.actionUrl,
        data: dataPayload,
      })
      .eq("id", existing.id);

    if (updateError) {
      console.error("Failed to update batched admin notification:", updateError);
    }

    return;
  }

  const { error: insertError } = await supabase.from("notifications").insert({
    user_id: adminUserId,
    type: "general",
    title: title,
    body: body,
    severity: severity,
    action_url: actionUrl,
    data: {
      ...dataPayload,
      count: 1,
    },
    displayed: false,
    read: false,
  });

  if (insertError) {
    console.error("Failed to insert batched admin notification:", insertError);
  }
}

export async function notifyAdminsBatched(event: AdminBatchEvent) {
  const adminIds = await getAdminUserIds();
  if (!adminIds.length) {
    console.warn("No admin users found to notify.");
    return;
  }

  await Promise.all(
    adminIds.map((adminId) => createOrUpdateBatchNotification(adminId, event))
  );
}

export async function notifyAdminUserBatched(adminUserId: string, event: AdminBatchEvent) {
  await createOrUpdateBatchNotification(adminUserId, event);
}
