"use server";

import { createClient } from "@/utils/supabase/server";
import { z } from "zod";

const ApplicationSchema = z.object({
  name: z.string().min(2).max(50),
  email: z.string().email().max(100),
  reason: z.string().min(10).max(500),
});

export async function submitTrustedMember(input: { name: string; email: string; reason: string }) {
  const supabase = await createClient();

  const parsed = ApplicationSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message || "Invalid input" };
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be logged in" };
  }

  // Check existing application
  const { data: existing, error: selectError } = await supabase
    .from("trusted_member")
    .select("id, status")
    .eq("id", user.id)
    .maybeSingle();

    console.log("existing:", existing);
  if (selectError) {
    console.error("Error checking existing application:", selectError);
    console.log("existing:", existing);
    return { error: "Failed to check existing application" };
  }

  // If already accepted, block
  if (existing?.status === true) {
    return { error: "You are already a Trusted Member" };
  }

  // If denied, keep the record but reset status to null if you want to allow re-apply; for now, keep as guidance
  if (existing && existing.status === false) {
    // We’ll not auto-reset denied; instruct the user via UI to contact support
    return { error: "Your previous application was not approved. Please contact support@lets-assist.com." };
  }

  // Insert new or update pending
  if (!existing) {
    const { error: upsertError } = await supabase
      .from("trusted_member")
      .upsert(
        {
          id: user.id,
          name: parsed.data.name,
          email: parsed.data.email,
          reason: parsed.data.reason,
          status: null,
        },
        { onConflict: "id" }
      );
    if (upsertError) {
      console.error("Error inserting application:", upsertError);
      return { error: "Failed to submit application" };
    }
  } else if (existing.status === null) {
    const { error: updateError } = await supabase
      .from("trusted_member")
      .update({ name: parsed.data.name, email: parsed.data.email, reason: parsed.data.reason })
      .eq("id", existing.id);
    if (updateError) {
      console.error("Error updating application:", updateError);
      return { error: "Failed to update application" };
    }
  }

  return { success: true };
}
