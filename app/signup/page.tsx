import { Metadata } from "next";
import SignupClient from "./SignupClient";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = {
  title: "Sign Up",
  description: "Join Let's Assist and start making a difference by finding volunteering opportunities.",
};

interface SignupPageProps {
  searchParams: Promise<{ redirect?: string; staff_token?: string; org?: string }>;
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const { redirect, staff_token, org } = await searchParams;
  
  // If staff_token is provided, validate it and get org info
  let validStaffToken: string | undefined;
  let orgUsername: string | undefined;
  
  if (staff_token && org) {
    const supabase = await createClient();
    
    // Verify the token is valid for the org
    const { data: orgData } = await supabase
      .from("organizations")
      .select("username, staff_join_token, staff_join_token_expires_at")
      .eq("username", org)
      .single();
    
    if (
      orgData &&
      orgData.staff_join_token === staff_token &&
      orgData.staff_join_token_expires_at &&
      new Date(orgData.staff_join_token_expires_at) > new Date()
    ) {
      validStaffToken = staff_token;
      orgUsername = org;
    }
  }
  
  return (
    <SignupClient 
      redirectPath={redirect ?? ""} 
      staffToken={validStaffToken}
      orgUsername={orgUsername}
    />
  );
}
