import { Metadata } from "next";
import ResetPasswordForm from "./ResetPasswordForm";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Set New Password - Let's Assist",
  description: "Set a new password for your Let's Assist account.",
};

type Props = {
  params: Promise<{ token: string }>;
};

export default async function ResetPasswordTokenPage({
  params,
}: Props) {
  // Await params before accessing token
  const awaitedParams = await params;
  const { token } = awaitedParams;

  // No session check or token validation here
  // Token will be validated during password update
  if (!token) {
    redirect("/reset-password");
  }

  // Pass only the token to the form component
  return <ResetPasswordForm token={token} />;
}
