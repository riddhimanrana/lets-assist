import { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import SignupClient from "./SignupClient";

export const metadata: Metadata = {
  title: "Sign Up - Let's Assist",
  description: "Join Let's Assist and start making a difference by finding volunteering opportunities.",
};

export default async function SignupPage() {
  // Check if user is already logged in
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (user) {
    // If user is already logged in, redirect to home page
    redirect("/home");
  }

  return <SignupClient />;
}
