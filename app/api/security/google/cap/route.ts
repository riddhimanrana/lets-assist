import { NextRequest, NextResponse } from "next/server";
import {
  handleGoogleCapPayload,
  validateGoogleCapToken,
} from "@/lib/security/google-cap";

function readTokenFromBody(rawBody: string): string | null {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as {
        token?: string;
        security_event_token?: string;
        jwt?: string;
      };
      return parsed.token ?? parsed.security_event_token ?? parsed.jwt ?? null;
    } catch {
      return null;
    }
  }

  return trimmed;
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    const token = readTokenFromBody(raw);

    if (!token) {
      return NextResponse.json(
        { error: "Missing security event token" },
        { status: 400 },
      );
    }

    const decoded = await validateGoogleCapToken(token);
    const handled = await handleGoogleCapPayload(decoded);

    console.info("Google CAP event handled", {
      jti: handled.jti,
      subjectsCount: handled.subjectsCount,
      results: handled.results,
    });

    // Per Google CAP docs, acknowledge valid tokens with HTTP 202.
    return NextResponse.json({ received: true }, { status: 202 });
  } catch (error) {
    console.error("Google CAP token processing failed", error);
    return NextResponse.json(
      { error: "Invalid security event token" },
      { status: 400 },
    );
  }
}