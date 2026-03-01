import { Metadata } from "next";
import LoginClient from "./LoginClient";

export const metadata: Metadata = {
  title: "Login",
  description:
    "Log in to your Let's Assist account and start connecting with volunteer opportunities.",
};

interface LoginPageProps {
  searchParams: Promise<{ redirect?: string; staff_token?: string; org?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { redirect, staff_token, org } = await searchParams;
  const redirectPath = redirect ?? "";
  return (
    <LoginClient
      redirectPath={redirectPath}
      staffToken={staff_token}
      orgUsername={org}
    />
  );
}
