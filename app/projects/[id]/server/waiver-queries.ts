import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import { getAnonymousSignupAccessRecord } from "@/lib/anonymous-signup-access";
import { WAIVER_SIGNATURE_BUCKET } from "./shared";

export async function getUserProfile() {
  "use server";
  const supabase = await createClient();

  try {
    // Get current user using getClaims() for better performance
    const { user, error: userError } = await getAuthUser();

    if (userError || !user) {
      return { error: "Not authenticated" };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, phone")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      console.error("Error fetching profile:", profileError);
      return { error: "Failed to fetch profile" };
    }

    return {
      profile: {
        full_name: profile.full_name || null,
        email: user.email || null,
        phone: profile.phone || null,
      },
    };
  } catch (error) {
    console.error("Error in getUserProfile:", error);
    return { error: "An unexpected error occurred" };
  }
}

export async function getWaiverDownloadUrl(
  signupId: string,
  anonymousSignupId?: string,
  anonymousSignupToken?: string,
) {
  "use server";
  const supabase = await createClient();
  const serviceSupabase = getAdminClient();

  try {
    // Get current user using getClaims() for better performance
    const { user } = await getAuthUser();

    type SignupForWaiver = {
      id: string;
      user_id: string | null;
      anonymous_id: string | null;
      project?: {
        creator_id: string | null;
        organization_id: string | null;
      } | null;
    };

    const { data: signup, error: signupError } = (await serviceSupabase
      .from("project_signups")
      .select(
        "id, user_id, anonymous_id, project:projects(creator_id, organization_id)",
      )
      .eq("id", signupId)
      .single()) as {
      data: SignupForWaiver | null;
      error: { message?: string } | null;
    };

    if (signupError || !signup) {
      return { error: "Signup not found" };
    }

    let hasPermission = false;

    if (user) {
      if (signup.user_id === user.id) {
        hasPermission = true;
      } else if (signup.project?.creator_id === user.id) {
        hasPermission = true;
      } else if (signup.project?.organization_id) {
        const { data: orgMember } = await supabase
          .from("organization_members")
          .select("role")
          .eq("organization_id", signup.project.organization_id)
          .eq("user_id", user.id)
          .single();

        if (orgMember && ["admin", "staff"].includes(orgMember.role)) {
          hasPermission = true;
        }
      }
    } else if (anonymousSignupId && signup.anonymous_id === anonymousSignupId) {
      const { data: anonSignup, error: anonAccessError } =
        await getAnonymousSignupAccessRecord({
          anonymousSignupId,
          token: anonymousSignupToken,
          columns: "id",
        });

      if (!anonAccessError && anonSignup) {
        hasPermission = true;
      }
    }

    if (!hasPermission) {
      return { error: "Unauthorized" };
    }

    const { data: waiverSignature, error: waiverError } = await serviceSupabase
      .from("waiver_signatures")
      .select(
        "id, signature_type, signature_storage_path, upload_storage_path, signature_payload, signature_text, signed_at, signer_name",
      )
      .eq("signup_id", signupId)
      .maybeSingle();

    if (waiverError || !waiverSignature) {
      return { error: "Waiver signature not found" };
    }

    // Priority 1: Offline upload (direct file)
    if (waiverSignature.upload_storage_path) {
      const { data: signedUrl, error: urlError } = await serviceSupabase.storage
        .from(WAIVER_SIGNATURE_BUCKET)
        .createSignedUrl(waiverSignature.upload_storage_path, 3600);

      if (!urlError && signedUrl?.signedUrl) {
        return { url: signedUrl.signedUrl, signatureId: waiverSignature.id };
      }
    }

    // Priority 2: Legacy signature (single image/file)
    if (waiverSignature.signature_storage_path) {
      const { data: signedUrl, error: urlError } = await serviceSupabase.storage
        .from(WAIVER_SIGNATURE_BUCKET)
        .createSignedUrl(waiverSignature.signature_storage_path, 3600);

      if (!urlError && signedUrl?.signedUrl) {
        return { url: signedUrl.signedUrl, signatureId: waiverSignature.id };
      }
    }

    // Priority 3: Multi-signer payload (needs on-demand generation)
    if (waiverSignature.signature_payload) {
      // Return the signature ID so client can use download API
      return {
        signatureId: waiverSignature.id,
        // No direct URL - client will use /api/waivers/[signatureId]/download
      };
    }

    // Fallback for typed signatures
    if (
      waiverSignature.signature_text ||
      waiverSignature.signature_type === "typed"
    ) {
      return {
        signatureId: waiverSignature.id,
        signature: waiverSignature,
      };
    }

    return { error: "No waiver data available" };
  } catch (error) {
    console.error("Error generating waiver download URL:", error);
    return { error: "Failed to generate waiver URL" };
  }
}

export async function getAnonymousWaiverSignatureMeta(
  signupId: string,
  anonymousSignupId: string,
  anonymousSignupToken?: string,
): Promise<
  | {
      signatureId: string;
      signature_type: string | null;
      signed_at: string | null;
    }
  | { signatureId: null; signature_type: null; signed_at: null }
  | { error: string }
> {
  "use server";
  const admin = getAdminClient();

  try {
    const { data: anonSignup, error: anonAccessError } =
      await getAnonymousSignupAccessRecord({
        anonymousSignupId,
        token: anonymousSignupToken,
        columns: "id",
      });

    if (anonAccessError || !anonSignup) {
      return { error: "Unauthorized" };
    }

    // Anonymous-only helper: verify the anonymous signup owns this project_signup.
    const { data: signup, error: signupError } = await admin
      .from("project_signups")
      .select("id, anonymous_id")
      .eq("id", signupId)
      .maybeSingle();

    if (signupError || !signup) {
      return { error: "Signup not found" };
    }

    if (!signup.anonymous_id || signup.anonymous_id !== anonymousSignupId) {
      return { error: "Unauthorized" };
    }
    const { data: sig, error: sigError } = await admin
      .from("waiver_signatures")
      .select("id, signature_type, signed_at")
      .eq("signup_id", signupId)
      .order("signed_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sigError) {
      console.error("Error loading anonymous waiver signature meta:", sigError);
      return { error: "Failed to load waiver" };
    }

    if (!sig) {
      return { signatureId: null, signature_type: null, signed_at: null };
    }

    return {
      signatureId: sig.id,
      signature_type: sig.signature_type ?? null,
      signed_at: sig.signed_at ?? null,
    };
  } catch (error) {
    console.error("Error in getAnonymousWaiverSignatureMeta:", error);
    return { error: "Failed to load waiver" };
  }
}

export async function getMyWaiverSignatures(projectId: string): Promise<
  | {
      signatures: Array<{
        id: string;
        signed_at: string | null;
        created_at: string;
      }>;
    }
  | { error: string }
> {
  "use server";
  try {
    const { user, error: userError } = await getAuthUser();
    if (userError || !user) {
      return { error: "Not authenticated" };
    }

    const admin = getAdminClient();

    const { data, error } = await admin
      .from("waiver_signatures")
      .select(
        `
        id,
        signed_at,
        created_at
      `,
      )
      .eq("user_id", user.id)
      .eq("project_id", projectId)
      .order("signed_at", { ascending: false });

    if (error) {
      console.error("Error fetching my waiver signatures:", error);
      return { error: "Failed to load waivers" };
    }

    return { signatures: data ?? [] };
  } catch (error) {
    console.error("Error in getMyWaiverSignatures:", error);
    return { error: "Failed to load waivers" };
  }
}
