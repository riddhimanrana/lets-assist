import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") || "/home";

  if (!token_hash || !type) {
    redirect("/error?message=Missing confirmation parameters");
  }

  const supabase = await createClient();

  // Verify the token
  const { data, error } = await supabase.auth.verifyOtp({
    type,
    token_hash,
  });

  if (error) {
    console.error("Verification error:", error);
    redirect("/error?message=" + encodeURIComponent(error.message));
  }

  // For email change type, update profiles table
  if (type === "email_change" && data?.user) {
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ 
        email: data.user.email,
        updated_at: new Date().toISOString()
      })
      .eq("id", data.user.id);

    if (profileError) {
      console.error("Profile update error:", profileError);
      // Continue anyway since the auth email was updated
    }

    return redirect("/auth/verification-success?type=email_change");
  }

  const userEmail = data.user?.email;
  // Sign the user out
  await supabase.auth.signOut();

  // Redirect to the login page with a success message
  const redirectUrl = new URL('/login', request.url);
  redirectUrl.searchParams.set('verified', 'true');
  if (userEmail) {
    redirectUrl.searchParams.set('email', userEmail);
  }
  redirect(redirectUrl.toString());
}
