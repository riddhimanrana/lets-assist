import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";

async function redirectToSuccess(request: NextRequest, email?: string, type: "signup" | "email_change" = "signup") {
  const origin = new URL(request.url).origin;
  const redirectUrl = new URL(`${origin}/auth/verification-success`);
  redirectUrl.searchParams.set("type", type);
  if (email) {
    redirectUrl.searchParams.set("email", email);
  }
  redirect(redirectUrl.toString());
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = (searchParams.get("type") as EmailOtpType | null) ?? null;
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/home";

  const supabase = await createClient();

  try {
    if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        console.error("Code exchange error:", error);
        return redirect(`/error?message=${encodeURIComponent(error.message)}`);
      }

      const userEmail = data?.session?.user?.email;
      await supabase.auth.signOut();
      return redirectToSuccess(request, userEmail, type === "email_change" ? "email_change" : "signup");
    }

    if (!token_hash || !type) {
      return redirect(`/error?message=Missing%20confirmation%20parameters`);
    }

    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });

    if (error) {
      console.error("Verification error:", error);
      return redirect(`/error?message=${encodeURIComponent(error.message)}`);
    }

    if (type === "email_change" && data?.user) {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          email: data.user.email,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.user.id);

      if (profileError) {
        console.error("Profile update error:", profileError);
      }

      return redirectToSuccess(request, data.user.email, "email_change");
    }

    const userEmail = data?.user?.email;
    await supabase.auth.signOut();
    return redirectToSuccess(request, userEmail, "signup");
  } catch (error) {
    console.error("Confirmation error:", error);
    return redirect(`/error?message=${encodeURIComponent((error as Error).message)}`);
  }
}
