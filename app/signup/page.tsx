import { Metadata } from "next";
import SignupClient from "./SignupClient";

export const metadata: Metadata = {
  title: "Sign Up",
  description: "Join Let's Assist and start making a difference by finding volunteering opportunities.",
};

interface SignupPageProps {
  searchParams: Promise<{ redirect?: string; staff_token?: string; org?: string }>;
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const { redirect, staff_token, org } = await searchParams;
  
  return (
    <SignupClient 
      redirectPath={redirect ?? ""} 
      staffToken={staff_token}
      orgUsername={org}
    />
  );
}
