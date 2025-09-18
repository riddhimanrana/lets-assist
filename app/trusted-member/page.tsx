import { Metadata } from "next";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import TrustedMemberClient from "./TrustedMemberClient";

export const metadata: Metadata = {
  title: "Trusted Member Application",
  description: "Apply to become a trusted member and unlock the ability to create projects and organizations on Let's Assist.",
};

export default async function TrustedMemberPage() {
  const supabase = await createClient();
  
  // Check if user is logged in
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?redirect=/trusted-member");
  }

  // Get user profile to check if they're already a trusted member
  const { data: profile } = await supabase
    .from("profiles")
    .select("trusted_member, full_name, email")
    .eq("id", user.id)
    .single();

  // Check if user has an existing application
  const { data: existingApplication } = await supabase
    .from("trusted_member")
    .select("*")
    .eq("email", user.email)
    .single();

  return (
    <div className="container mx-auto p-4 sm:p-8 max-w-2xl">
      <TrustedMemberClient 
        user={user}
        profile={profile}
        existingApplication={existingApplication}
      />
    </div>
  );
}