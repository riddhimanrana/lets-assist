"use server";

import { createClient } from "@/utils/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export async function deleteAccount() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new Error("No user found");
    }

    // Delete from public.profiles first
    const { error: profileError } = await supabase
      .from("profiles")
      .delete()
      .eq("id", user.id);

    if (profileError) {
      throw new Error(`Failed to delete profile: ${profileError.message}`);
    }

    // Create admin client with service role
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Delete from auth schema using admin client
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(
      user.id,
    );

    if (authError) {
      throw new Error(`Failed to delete user: ${authError.message}`);
    }

    // Clear auth session
    await supabase.auth.signOut();

    return { success: true };
  } catch (error) {
    console.error("Delete account error:", error);
    throw error;
  }
}
