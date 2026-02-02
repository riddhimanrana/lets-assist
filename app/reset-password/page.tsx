import { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
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
  // @ts-ignore - getClaims exists in GoTrueClient
  const { data: claimsData } = await supabase.auth.getClaims();
  if (claimsData?.claims) {
    await supabase.auth.signOut();
    redirect('/reset-password');
  }

  // Explicitly read the search param before passing it
  const search = await searchParams;
  const error = search.error;

  return <ResetPasswordClient error={error} />;
}
