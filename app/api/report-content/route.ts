import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import { consumeAiQuota } from "@/lib/ai/rate-limit";
import { getRequestIp } from "@/lib/ai/parse-project-rate-limit-config";
import { notifyAdminsBatched } from "@/services/admin-notifications";
import { NextResponse } from "next/server";
import { after } from "next/server";
import { logError, logInfo, flushLogs } from "@/lib/logger";
import {
  buildReportDescription,
  contentReportSchema,
  ContentReportBodyError,
  normalizeReportedContentUrl,
  readBoundedContentReportBody,
} from "@/lib/moderation/content-report-submission";

export async function POST(request: Request) {
  try {
    const { user, error: authError } = await getAuthUser({ sensitive: true });

    if (authError) {
      return NextResponse.json(
        { error: "Authentication is temporarily unavailable." },
        { status: 503, headers: { "Retry-After": "5" } },
      );
    }
    if (!user) {
      return NextResponse.json(
        { error: "You must be signed in to report content." },
        { status: 401 },
      );
    }

    let body: unknown;
    try {
      body = await readBoundedContentReportBody(request);
    } catch (bodyError) {
      return NextResponse.json(
        { error: "Invalid report details" },
        {
          status:
            bodyError instanceof ContentReportBodyError &&
            bodyError.code === "too_large"
              ? 413
              : 400,
        },
      );
    }
    const parsed = contentReportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid report details" },
        { status: 400 },
      );
    }
    const { contentType, contentId, reason } = parsed.data;
    let normalizedContentUrl: string | undefined;
    try {
      normalizedContentUrl = normalizeReportedContentUrl(
        parsed.data.url,
        request.url,
      );
    } catch {
      return NextResponse.json(
        { error: "Invalid report details" },
        { status: 400 },
      );
    }

    let quota: Awaited<ReturnType<typeof consumeAiQuota>>;
    try {
      quota = await consumeAiQuota({
        feature: "moderation-content-report",
        windowSeconds: 3_600,
        buckets: [
          { scope: "user", identifier: user.id, limit: 10 },
          { scope: "ip", identifier: getRequestIp(request.headers), limit: 30 },
        ],
      });
    } catch {
      return NextResponse.json(
        { error: "Reporting is temporarily unavailable." },
        { status: 503, headers: { "Retry-After": "5" } },
      );
    }
    if (!quota.allowed) {
      const retryAfterSeconds = Math.max(
        Math.ceil((new Date(quota.resetAt).getTime() - Date.now()) / 1_000),
        1,
      );
      return NextResponse.json(
        { error: "Too many reports. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": retryAfterSeconds.toString() },
        },
      );
    }

    const priority =
      reason === "violence" || reason === "hate_speech" ? "high" : "normal";
    const now = new Date().toISOString();
    const { data, error } = await getAdminClient()
      .from("content_reports")
      .insert({
        reporter_id: user.id,
        content_type: contentType,
        content_id: contentId,
        reason,
        description: buildReportDescription(parsed.data, normalizedContentUrl),
        status: "pending",
        priority,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (error) {
      logError(
        "Failed to insert content report",
        new Error("report_insert_failed"),
        {
          content_type: contentType,
          reason,
        },
      );

      after(async () => {
        await flushLogs();
      });

      return NextResponse.json(
        { error: "Failed to submit report" },
        { status: 500 },
      );
    }

    try {
      await notifyAdminsBatched({
        type: "content_report",
        reportId: data.id,
        reason,
        contentType,
        priority,
      });
    } catch {
      logError(
        "Failed to send admin notification for content report",
        new Error("report_notification_failed"),
        {
          report_id: data.id,
          content_type: contentType,
          reason,
        },
      );
      // Don't fail the request if notification fails
    }

    logInfo("Content report submitted successfully", {
      report_id: data.id,
      content_type: contentType,
      reason,
      priority,
    });

    after(async () => {
      await flushLogs();
    });

    return NextResponse.json({
      success: true,
      reportId: data.id,
      message: "Report submitted successfully",
    });
  } catch {
    logError(
      "Unexpected error in report-content API",
      new Error("report_request_failed"),
    );

    after(async () => {
      await flushLogs();
    });

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
