import { Metadata } from "next";
// import { createClient } from "@/utils/supabase/server";
// import { redirect } from "next/navigation";
import ProfileClient from "./ProfileClient";

export const metadata: Metadata = {
  title: "Account Settings",
  description: "Manage your Let's Assist account settings",
};

export default async function ProfilePage() {
  // Check if user is authenticated
  // const supabase = await createClient();
  // const { data: { user } } = await supabase.auth.getUser();
  
  // if (!user) {
  //   // Redirect unauthenticated users to login
  //   redirect("/login?redirect=/account/profile");
  // }

  return <ProfileClient />;
}
