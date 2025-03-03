import { Metadata } from "next";
// import { createClient } from "@/utils/supabase/server";
// import { redirect } from "next/navigation";
import AuthenticationClient from "./AuthenticationClient";

export const metadata: Metadata = {
  title: "Authentication Settings",
  description: "Manage your Let's Assist authentication settings",
};

export default async function AuthenticationPage() {
  // Check if user is authenticated
  // const supabase = await createClient();
  // const { data: { user } } = await supabase.auth.getUser();
  
  // if (!user) {
  //   // Redirect unauthenticated users to login
  //   redirect("/login?redirect=/account/authentication");
  // }

  return <AuthenticationClient />;
}
