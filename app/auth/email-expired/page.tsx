import { Metadata } from "next";
import EmailExpiredClient from "./EmailExpiredClient";

export const metadata: Metadata = {
  title: "Email Link Expired",
  description: "Your email verification link has expired. Request a new one.",
};

interface EmailExpiredPageProps {
  searchParams: Promise<{ email?: string }>;
}

export default async function EmailExpiredPage({
  searchParams,
}: EmailExpiredPageProps) {
  const { email } = await searchParams;
  return <EmailExpiredClient email={email ?? ""} />;
}
