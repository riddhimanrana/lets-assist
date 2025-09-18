"use server";

import { createClient } from "@/utils/supabase/server";
import { trustedMemberSchema, type TrustedMemberFormData } from "@/schemas/trusted-member-schema";
import { redirect } from "next/navigation";

export async function submitTrustedMemberApplication(data: TrustedMemberFormData) {
  const supabase = await createClient();

  // Authenticate user
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("User not authenticated");
  }

  // Validate the form data
  const validatedData = trustedMemberSchema.parse(data);

  // Check if user already has an application
  const { data: existingApplication } = await supabase
    .from('trusted_member')
    .select('id')
    .eq('email', validatedData.email)
    .single();

  if (existingApplication) {
    throw new Error("You already have a pending or processed application");
  }

  // Insert the application
  const { error } = await supabase
    .from('trusted_member')
    .insert({
      name: validatedData.name,
      email: validatedData.email,
      reason: validatedData.reason,
      status: null // null means pending
    });

  if (error) {
    console.error("Error submitting trusted member application:", error);
    throw new Error("Failed to submit application");
  }

  return { success: true };
}