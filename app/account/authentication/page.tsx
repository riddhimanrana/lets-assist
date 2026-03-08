import { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AuthenticationClient from "./AuthenticationClient";

export const metadata: Metadata = {
  title: "Authentication Settings",
  description: "Manage your Let's Assist authentication settings",
};

export default async function AuthenticationPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?redirect=/account/authentication");
  }

  return <AuthenticationClient />;
}
