import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";

export const runtime = "nodejs";

export async function GET() {
  const { user, error: authError } = await getAuthUser({ sensitive: true });

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    {
      error:
        "Direct downloads are disabled. Please request an email export from your account security page.",
    },
    { status: 410 },
  );
}