import { NextResponse } from "next/server";
import { DEV_PREVIEW_SOURCE_COOKIE } from "@/lib/supabase/preview-source";

/**
 * GET /api/dev/reset-preview
 *
 * Development-only endpoint. Resets the remote-preview cookie to "local"
 * and redirects back to the login page.
 *
 * Use this whenever you're stuck in Remote Preview mode while logged out.
 * Just open: http://localhost:3000/api/dev/reset-preview
 */
export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  const response = NextResponse.redirect(
    `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/login`,
  );

  response.cookies.set(DEV_PREVIEW_SOURCE_COOKIE, "local", {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
    httpOnly: false,
  });

  return response;
}
