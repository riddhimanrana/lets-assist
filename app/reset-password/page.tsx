import { Metadata } from "next";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import ResetPasswordClient from "./ResetPasswordClient";

export const metadata: Metadata = {
  title: "Reset Password - Let's Assist",
  description: "Reset your Let's Assist password.",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: { token?: string; error?: string };
}) {
  const supabase = await createClient();

  // If user is authenticated, sign them out
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase.auth.signOut();
    redirect('/reset-password');
  }

  return <ResetPasswordClient error={searchParams.error} />;
}
