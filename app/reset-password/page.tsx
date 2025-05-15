import { Metadata } from "next";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import ResetPasswordClient from "./ResetPasswordClient";

export const metadata: Metadata = {
  title: "Reset Password",
  description: "Reset your Let's Assist password.",
};


type Props = {
  searchParams: Promise<{ token?: string; error?: string }>;
};

export default async function ResetPasswordPage({
  searchParams,
}: Props) {
  const supabase = await createClient();

  // If user is authenticated, sign them out
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase.auth.signOut();
    redirect('/reset-password');
  }

  // Explicitly read the search param before passing it
  const search = await searchParams;
  const error = search.error;

  return <ResetPasswordClient error={error} />;
}
