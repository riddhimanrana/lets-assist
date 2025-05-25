import { Metadata } from "next";
import LoginClient from "./LoginClient";

export const metadata: Metadata = {
  title: "Login",
  description:
    "Log in to your Let's Assist account and start connecting with volunteer opportunities.",
};

interface LoginPageProps {
  searchParams: Promise<{ redirect?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { redirect } = await searchParams;
  const redirectPath = redirect ?? "";
  return <LoginClient redirectPath={redirectPath} />;
}
