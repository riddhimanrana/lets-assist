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
  const token = searchParams.get("token");
  const typeParam = (searchParams.get("type") as EmailOtpType | null) ?? null;
  const type: EmailOtpType = typeParam ?? "signup";
  const code = searchParams.get("code");

  const isExpiredLinkError = (message: string) => {
    const lowered = message.toLowerCase();
    return lowered.includes("expired") || lowered.includes("otp") || lowered.includes("token");
  };

  const supabase = await createClient();

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error("Code exchange error:", error);
      if (type === "signup" && isExpiredLinkError(error.message ?? "")) {
        return redirect("/auth/email-expired");
      }
      return redirect(`/error?message=${encodeURIComponent(error.message)}`);
    }

    const userEmail = data?.session?.user?.email;
    await supabase.auth.signOut();
    return redirectToSuccess(request, userEmail, type === "email_change" ? "email_change" : "signup");
  }

  if (!token_hash && !token && !code) {
    console.warn("Confirmation hit without parameters, assuming success");
    return redirectToSuccess(request, undefined, type === "email_change" ? "email_change" : "signup");
  }

  const tokenValue = token_hash ?? token;

  if (!tokenValue) {
    console.error("Missing token for verification");
    return redirect("/error");
  }

  const { data, error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenValue,
  });

  if (error) {
    console.error("Verification error:", error);
    if (type === "signup" && isExpiredLinkError(error.message ?? "")) {
      return redirect("/auth/email-expired");
    }
    return redirect(`/error?message=${encodeURIComponent(error.message)}`);
  }

  if (type === "email_change" && data?.user) {
    const { error: profileError } = (await supabase
      .from("profiles")
      .update({
        email: data.user.email,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.user.id)) as { error: { message?: string } | null };

    if (profileError) {
      console.error("Profile update error:", profileError);
    }

    return redirectToSuccess(request, data.user.email, "email_change");
  }

  const userEmail = data?.user?.email;
  await supabase.auth.signOut();
  return redirectToSuccess(request, userEmail, "signup");
}
