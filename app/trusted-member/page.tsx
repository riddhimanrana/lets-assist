import { Metadata } from "next";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import TrustedMemberClient from "./TrustedMemberClient";

export const metadata: Metadata = {
  title: "Trusted Member Application",
  description: "Apply to become a trusted member of Let's Assist",
};

export default async function TrustedMemberPage() {
  const supabase = await createClient();
  
  // Authentication check on the server
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return redirect("/login?redirect=/trusted-member");
  }

  // Get user profile information including trusted_member status
  const { data: userProfile } = await supabase
    .from('profiles')
    .select('full_name, email, trusted_member')
    .eq('id', user.id)
    .single();

  // Check if user already has a trusted member application
  const { data: existingApplication } = await supabase
    .from('trusted_member')
    .select('*')
    .eq('email', userProfile?.email)
    .single();

  return (
    <div className="container max-w-2xl py-6 px-4 mx-auto">
      <TrustedMemberClient 
        user={user}
        userProfile={userProfile}
        existingApplication={existingApplication}
      />
    </div>
  );
}