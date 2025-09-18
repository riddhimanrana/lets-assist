import { Metadata } from "next";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import TrustedMemberForm from "./TrustedMemberForm";

export const metadata: Metadata = {
  title: "Trusted Member Application",
  description: "Apply to become a trusted member and create projects and organizations on Let's Assist.",
};

export default async function TrustedMemberPage() {
  const supabase = await createClient();

  // Authentication check
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return redirect("/login?redirect=/trusted-member");
  }

  // Get user profile including trusted_member status
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email, trusted_member')
    .eq('id', user.id)
    .single();

  // Get existing application if any
  const { data: application } = await supabase
    .from('trusted_member')
    .select('*')
    .eq('email', profile?.email || user.email)
    .single();

  return (
    <div className="container mx-auto px-4 sm:px-8 lg:px-12 py-8 max-w-2xl">
      <TrustedMemberForm 
        profile={profile}
        application={application}
        userEmail={user.email || ''}
      />
    </div>
  );
}