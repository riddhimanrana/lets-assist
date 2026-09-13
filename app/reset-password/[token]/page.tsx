import { normalizeRedirectPath } from "@/app/signup/redirect-utils";
import { passwordRecoveryPath } from "../continuation";
import { Metadata } from "next";
import ResetPasswordForm from "./ResetPasswordForm";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Set New Password",
  description: "Set a new password for your Let's Assist account.",
};

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ redirect?: string | string[] }>;
};

export default async function ResetPasswordTokenPage({
  params,
  searchParams,
}: Props) {
  // Await params before accessing token
  const awaitedParams = await params;
  const { token } = awaitedParams;
  const requestedRedirect = (await searchParams).redirect;
  const continuation = normalizeRedirectPath(
    typeof requestedRedirect === "string" ? requestedRedirect : null,
  );

  // No session check or token validation here
  // Token will be validated during password update
  if (!token) {
    redirect(passwordRecoveryPath("/reset-password", continuation));
  }

  return <ResetPasswordForm token={token} redirectPath={continuation} />;
}
