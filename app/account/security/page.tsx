import { Metadata } from "next";
// import { createClient } from "@/utils/supabase/server";
// import { redirect } from "next/navigation";
import SecurityClient from "./SecurityClient";

export const metadata: Metadata = {
  title: "Privacy & Security",
  description: "Manage your account security with password management and account deletion options on Let's Assist.",
};

export default async function SecurityPage() {
  // // Check if user is authenticated
  // const supabase = await createClient();
  // const { data: { user } } = await supabase.auth.getUser();
  
  // if (!user) {
  //   // Redirect unauthenticated users to login
  //   redirect("/login?redirect=/account/security");
  // }

  return <SecurityClient />;
}
