import { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SecurityClient from "./SecurityClient";

export const metadata: Metadata = {
  title: "Sign-in & security",
  description:
    "Manage your login email, password, Google sign-in, two-factor authentication, data export and account deletion on Let's Assist.",
};

export default async function SecurityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?redirect=/account/security");
  }

  return <SecurityClient />;
}
