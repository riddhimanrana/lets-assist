"use server";

import { z } from "zod";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { verifyTurnstileToken, isTurnstileEnabled } from "@/lib/turnstile";
import { randomUUID } from "crypto";

const signupSchema = z.object({
  fullName: z.string().min(3, "Full name must be at least 3 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  turnstileToken: z.string().optional(),
  staffToken: z.string().optional(),
  orgUsername: z.string().optional(),
});

const getSiteUrl = () => {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/u, "") ||
    "http://localhost:3000"
  );
};

type SignupStatus = 
  | { type: 'confirmed'; message: string }
  | { type: 'unconfirmed'; message: string }
  | { type: 'new'; message: string };

export async function checkEmailStatus(email: string): Promise<SignupStatus> {
  try {
    const adminClient = createAdminClient();
    
    // Use admin client to check if user exists
    const { data: { users }, error } = await adminClient.auth.admin.listUsers();
    
    if (error) {
      console.error("Error checking email status:", error);
      throw error;
    }
    
    const existingUser = users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    
    if (!existingUser) {
      return { type: 'new', message: 'Email is available for signup' };
    }
    
    // Check if email is confirmed
    const isConfirmed = existingUser.email_confirmed_at !== null;
    
    if (isConfirmed) {
      return { 
        type: 'confirmed', 
        message: 'An account with this email already exists and is verified.' 
      };
    } else {
      return { 
        type: 'unconfirmed', 
        message: 'An account with this email exists but is not verified. We can resend the verification email.' 
      };
    }
  } catch (error) {
    console.error("Error in checkEmailStatus:", error);
    throw error;
  }
}

export async function signup(formData: FormData) {
  const turnstileToken = formData.get("turnstileToken") as string;
  const staffToken = formData.get("staffToken") as string | undefined;
  const orgUsername = formData.get("orgUsername") as string | undefined;

  const validatedFields = signupSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    turnstileToken,
    staffToken,
    orgUsername,
  });

  if (!validatedFields.success) {
    return { error: validatedFields.error.flatten().fieldErrors };
  }

  const supabase = await createClient();

  try {
    const origin = getSiteUrl();
    
    // Check email status first
    const emailStatus = await checkEmailStatus(validatedFields.data.email);
    
    if (emailStatus.type === 'confirmed') {
      return { 
        error: { server: [emailStatus.message] },
        emailStatus: 'confirmed'
      };
    }
    
    if (emailStatus.type === 'unconfirmed') {
      return { 
        error: { server: [emailStatus.message] },
        emailStatus: 'unconfirmed',
        email: validatedFields.data.email
      };
    }
    
    // Pass the CAPTCHA token to Supabase - it will handle verification
    const signUpOptions: any = {
      email: validatedFields.data.email,
      password: validatedFields.data.password,
      options: {
        data: {
          // Pass profile fields via user metadata; DB trigger will populate public.profiles
          full_name: validatedFields.data.fullName,
          username: `user_${randomUUID().slice(0, 8)}`,
          created_at: new Date().toISOString(),
        },
        emailRedirectTo: `${origin}/auth/confirm`,
      },
    };

    if (turnstileToken) {
      signUpOptions.options.captchaToken = turnstileToken;
    }

    // 1. Create auth user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.signUp(signUpOptions);

    if (authError) {
      if (authError.message.includes("User already registered")) {
        return { error: { server: ["An account with this email already exists. Please log in."] } };
      }
      throw authError;
    }

    if (!user) {
      throw new Error("No user returned");
    }

    // Profile row will be created/updated by DB trigger using user metadata

    // Handle staff token - add user to organization as staff
    if (staffToken && orgUsername) {
      try {
        await handleStaffTokenSignup(user.id, staffToken, orgUsername);
      } catch (staffError) {
        console.error("Error processing staff token:", staffError);
        // Don't fail signup if staff token processing fails
      }
    } else {
      // Check for auto-affiliation based on email domain
      try {
        await handleEmailDomainAffiliation(user.id, validatedFields.data.email);
      } catch (affiliationError) {
        console.error("Error processing email affiliation:", affiliationError);
        // Don't fail signup if affiliation processing fails
      }
    }

    return { 
      success: true, 
      email: validatedFields.data.email,
      message: "Successfully signed up! Please check your email (and junk folder) to confirm your account." 
    };
  } catch (error) {
    return { error: { server: [(error as Error).message] } };
  }
}

/**
 * Handle staff token signup - add user to organization as staff
 */
async function handleStaffTokenSignup(userId: string, staffToken: string, orgUsername: string) {
  const adminClient = createAdminClient();
  
  // Find the organization by username and verify the staff token
  const { data: org, error: orgError } = await adminClient
    .from("organizations")
    .select("id, staff_join_token, staff_join_token_expires_at")
    .eq("username", orgUsername)
    .single();

  if (orgError || !org) {
    console.error("Organization not found for staff token:", orgUsername);
    return;
  }

  // Verify the token matches and hasn't expired
  if (org.staff_join_token !== staffToken) {
    console.error("Staff token mismatch");
    return;
  }

  if (org.staff_join_token_expires_at && new Date(org.staff_join_token_expires_at) < new Date()) {
    console.error("Staff token expired");
    return;
  }

  // Add user to organization as staff
  const { error: memberError } = await adminClient
    .from("organization_members")
    .insert({
      organization_id: org.id,
      user_id: userId,
      role: "staff",
      joined_at: new Date().toISOString(),
    });

  if (memberError) {
    // Check if it's a duplicate - user might already be a member
    if (memberError.code === "23505") {
      console.log("User already a member of organization");
      return;
    }
    throw memberError;
  }

  console.log(`User ${userId} added as staff to organization ${org.id}`);
}

/**
 * Handle email domain affiliation - auto-add user to organization based on email domain
 * Returns the organization ID if the user was auto-added, null otherwise
 */
async function handleEmailDomainAffiliation(userId: string, email: string): Promise<string | null> {
  const adminClient = createAdminClient();
  
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;

  // Check if any organization has auto_join_domain set to this domain
  const { data: org, error: orgError } = await adminClient
    .from("organizations")
    .select("id, name")
    .eq("auto_join_domain", domain)
    .single();

  if (orgError || !org) {
    // No organization with this auto-join domain
    return null;
  }

  // Add user to the organization as a member
  const { error: memberError } = await adminClient
    .from("organization_members")
    .insert({
      organization_id: org.id,
      user_id: userId,
      role: "member",
      joined_at: new Date().toISOString(),
    });

  if (memberError) {
    // Skip if already a member (duplicate key)
    if (memberError.code !== "23505") {
      console.error(`Error adding user to org ${org.id}:`, memberError);
    }
    return null;
  }

  // Store the auto-joined organization info in user metadata for display after onboarding
  await adminClient.auth.admin.updateUserById(userId, {
    user_metadata: {
      auto_joined_org_id: org.id,
      auto_joined_org_name: org.name,
    }
  });

  console.log(`User ${userId} auto-affiliated with organization ${org.id} via domain ${domain}`);
  return org.id;
}

export async function resendVerificationEmail(email: string, turnstileToken?: string) {
  try {
    const supabase = await createClient();
    const origin = getSiteUrl();
    
    const options: Record<string, string> = {
      emailRedirectTo: `${origin}/auth/confirm`,
    };

    if (turnstileToken) {
      options.captchaToken = turnstileToken;
    }

    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email,
      options,
    });
    
    if (error) {
      console.error("Error resending verification email:", error);
      return { 
        success: false, 
        error: error.message || "Failed to resend verification email" 
      };
    }
    
    return { 
      success: true, 
      message: "Verification email has been resent. Please check your inbox." 
    };
  } catch (error) {
    console.error("Exception in resendVerificationEmail:", error);
    return { 
      success: false, 
      error: (error as Error).message || "An error occurred while resending the email" 
    };
  }
}

export async function signInWithGoogle(redirectAfterAuth?: string | null) {
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "";

  const supabase = await createClient();
  
  // Store the redirect URL in the session storage via a search parameter
  // This will be picked up in the auth callback and stored in session storage
  let redirectTo = `${origin}/auth/callback`;
  
  if (redirectAfterAuth) {
    redirectTo += `?redirectAfterAuth=${encodeURIComponent(redirectAfterAuth)}`;
  }

  const {
    data: { url },
    error,
  } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      queryParams: {
        access_type: "offline",
        prompt: "consent",
        scope: "openid email profile",
      },
      redirectTo,
    },
  });
  
  if (error) {
    console.error("Google OAuth error:", error);
    return { error: { server: [error.message] } };
  }
  
  return { url };
}
