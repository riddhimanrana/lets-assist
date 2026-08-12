"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { applyStaffInviteForUser } from "@/lib/organization/staff-invite";
import { getAdminClient } from "@/lib/supabase/admin";
import { applyVerifiedDomainAffiliation } from "@/lib/organization/verified-domain-affiliation";
import { runOnCanonicalAuthOrigin } from "@/app/signup/canonical-auth-request";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
  turnstileToken: z.string().nullish(),
});

export async function signInWithGoogle(
  redirectAfterAuth?: string | null,
  inviteContext?: { staffToken?: string; orgUsername?: string } | null,
) {
  return runOnCanonicalAuthOrigin("/login", async (origin) => {
    const supabase = await createClient();

    let redirectTo = `${origin}/auth/callback`;
    const params = new URLSearchParams();

    if (redirectAfterAuth) {
      params.set("redirectAfterAuth", redirectAfterAuth);
    }

    if (inviteContext?.staffToken) {
      params.set("staffToken", inviteContext.staffToken);
    }

    if (inviteContext?.orgUsername) {
      params.set("orgUsername", inviteContext.orgUsername);
    }

    const queryString = params.toString();
    if (queryString) {
      redirectTo += `?${queryString}`;
    }

    const {
      data: { url },
      error,
    } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        queryParams: {
          access_type: "offline",
          scope: "openid email profile",
        },
        redirectTo,
      },
    });

    if (error) {
      console.error("Google OAuth error:", error);
      return {
        error: {
          server: ["Unable to start Google sign-in. Please try again."],
        },
      };
    }

    return { url };
  });
}

export async function applyPostLoginAffiliations(
  staffToken?: string | null,
  orgUsername?: string | null,
) {
  const { user, error } = await getAuthUser({ sensitive: true });
  if (error || !user) {
    return {
      inviteOutcome: null,
      error: error?.message ?? "Not authenticated",
    };
  }

  const domainOutcome = await applyVerifiedDomainAffiliation(user.id);
  const metadata = user.user_metadata ?? {};
  const pendingStaffToken =
    typeof metadata.pending_staff_token === "string"
      ? metadata.pending_staff_token
      : null;
  const pendingOrgUsername =
    typeof metadata.pending_staff_org_username === "string"
      ? metadata.pending_staff_org_username
      : null;
  const resolvedStaffToken = staffToken || pendingStaffToken;
  const resolvedOrgUsername = orgUsername || pendingOrgUsername;

  const inviteOutcome =
    resolvedStaffToken && resolvedOrgUsername
      ? await applyStaffInviteForUser({
          userId: user.id,
          staffToken: resolvedStaffToken,
          orgUsername: resolvedOrgUsername,
        })
      : null;

  if (pendingStaffToken || pendingOrgUsername) {
    const admin = getAdminClient();
    await admin.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...metadata,
        pending_staff_token: null,
        pending_staff_org_username: null,
      },
    });
  }

  return { inviteOutcome, domainOutcome };
}

export async function login(formData: FormData) {
  const supabase = await createClient();
  const turnstileToken = formData.get("turnstileToken") as string;

  const validatedFields = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    turnstileToken,
  });

  if (!validatedFields.success) {
    return { error: validatedFields.error.flatten().fieldErrors };
  }

  // Pass the CAPTCHA token to Supabase - it will handle verification
  const signInOptions: {
    email: string;
    password: string;
    options?: { captchaToken: string };
  } = {
    email: validatedFields.data.email,
    password: validatedFields.data.password,
  };

  if (turnstileToken) {
    signInOptions.options = { captchaToken: turnstileToken };
  }

  const { data, error } = await supabase.auth.signInWithPassword(signInOptions);

  if (error) {
    return { error: { server: [error.message] } };
  }

  // Revalidate all routes to clear cached auth state
  revalidatePath("/", "layout");

  // Return the session so LoginClient can immediately use it
  // This is the critical fix - the server action returns the authenticated user
  return {
    success: true,
    session: data.session,
  };
}
