import { Metadata } from "next";
import { normalizeRedirectPath } from "@/app/signup/redirect-utils";
import EmailExpiredClient from "./EmailExpiredClient";

export const metadata: Metadata = {
  title: "Email Link Expired",
  description: "Your email verification link has expired. Request a new one.",
};

interface EmailExpiredPageProps {
  searchParams: Promise<{ email?: string; redirectAfterAuth?: string }>;
}

export default async function EmailExpiredPage({
  searchParams,
}: EmailExpiredPageProps) {
  const { email, redirectAfterAuth } = await searchParams;
  return <EmailExpiredClient email={email ?? ""} redirectAfterAuth={normalizeRedirectPath(redirectAfterAuth)} />;
}
