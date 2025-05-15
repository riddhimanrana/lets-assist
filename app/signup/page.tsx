import { Metadata } from "next";
import SignupClient from "./SignupClient";

export const metadata: Metadata = {
  title: "Sign Up",
  description: "Join Let's Assist and start making a difference by finding volunteering opportunities.",
};

interface SignupPageProps {
  searchParams: { redirect?: string };
}

export default function SignupPage({ searchParams }: SignupPageProps) {
  const redirect = searchParams.redirect ?? "";
  return <SignupClient redirectPath={redirect} />;
}
