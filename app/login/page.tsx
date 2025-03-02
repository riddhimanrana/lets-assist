import { Metadata } from "next";
// import { redirect } from "next/navigation";
// import { createClient } from "@/utils/supabase/server";
import LoginClient from "./LoginClient";

export const metadata: Metadata = {
  title: "Login - Let's Assist",
  description: "Log in to your Let's Assist account and start connecting with volunteer opportunities.",
};

export default async function LoginPage() {
  // // Check if user is already logged in
  // const supabase = await createClient();
  // const { data: { user } } = await supabase.auth.getUser();
  
  // if (user) {
  //   // If user is already logged in, redirect to home page
  //   redirect("/home");
  // }

  return <LoginClient />;
}
