import { NextRequest, NextResponse } from "next/server";
import { cronTokens, isCronBearerAuthorized } from "@/lib/cron/cron-auth";
import { performAiModerationScan } from "@/app/admin/moderation/ai-scan-logic";

function authorizeCronRequest(request: NextRequest) {
  const tokens = cronTokens();

  if (tokens.length === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Cron secret not configured" },
        { status: 500 },
      ),
    };
  }

  if (!isCronBearerAuthorized(request.headers.get("authorization"), tokens)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true } as const;
}

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await performAiModerationScan();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Cron job failed:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
