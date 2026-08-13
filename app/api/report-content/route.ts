import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { notifyAdminsBatched } from "@/services/admin-notifications";
import { NextResponse } from "next/server";
import { after } from "next/server";
import { logError, logInfo, flushLogs } from "@/lib/logger";
import { submitContentReport } from "@/lib/moderation/content-report-service";
import {
  contentReportSchema,
  ContentReportBodyError,
  readBoundedContentReportBody,
} from "@/lib/moderation/content-report-submission";

const UNAVAILABLE = {
  body: { error: "Reporting is temporarily unavailable." },
  init: { status: 503, headers: { "Retry-After": "5" } },
} as const;

export async function POST(request: Request) {
  // Scheduled once, for every exit. Several refusals below — a rejected
  // target, an exhausted quota — are exactly the ones worth having telemetry
  // for, and attaching the flush to individual branches had already missed
  // them. `forceFlush` on an empty buffer costs nothing.
  after(async () => {
    await flushLogs();
  });

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

    const result = await submitContentReport({
      reporterId: user.id,
      submission: parsed.data,
      requestHeaders: request.headers,
    });

    if (result.status === "invalid_input") {
      return NextResponse.json(
        { error: "Invalid report details" },
        { status: 400 },
      );
    }

    if (result.status === "rate_limited") {
      return NextResponse.json(
        { error: "Too many reports. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": result.retryAfterSeconds.toString() },
        },
      );
    }

    if (result.status === "unavailable") {
      return NextResponse.json(UNAVAILABLE.body, UNAVAILABLE.init);
    }

    // A replayed submission already produced its notification; sending another
    // would turn a network retry into duplicate moderator traffic.
    if (result.status === "created") {
      try {
        await notifyAdminsBatched({
          type: "content_report",
          reportId: result.reportId,
          reason: parsed.data.reason,
          contentType: parsed.data.contentType,
          priority:
            parsed.data.reason === "violence" ||
            parsed.data.reason === "hate_speech"
              ? "high"
              : "normal",
        });
      } catch {
        logError(
          "Failed to send admin notification for content report",
          new Error("report_notification_failed"),
          {
            report_id: result.reportId,
            content_type: parsed.data.contentType,
            reason: parsed.data.reason,
          },
        );
        // Don't fail the request if notification fails
      }
    }

    logInfo("Content report submitted successfully", {
      report_id: result.reportId,
      content_type: parsed.data.contentType,
      reason: parsed.data.reason,
      replayed: result.status === "replayed",
    });

    return NextResponse.json({
      success: true,
      reportId: result.reportId,
      message: "Report submitted successfully",
    });
  } catch {
    logError(
      "Unexpected error in report-content API",
      new Error("report_request_failed"),
    );

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
