import { Metadata } from "next";
import ResetPasswordForm from "./ResetPasswordForm";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Set New Password - Let's Assist",
  description: "Set a new password for your Let's Assist account.",
};

export default async function ResetPasswordTokenPage({
  params,
}: {
  params: { token: string };
}) {
  // No session check or token validation here
  // Token will be validated during password update
  if (!params.token) {
    redirect("/reset-password");
  }

  return <ResetPasswordForm token={params.token} />;
}
