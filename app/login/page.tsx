import { Metadata } from "next";
import LoginClient from "./LoginClient";

export const metadata: Metadata = {
  title: "Login - Let's Assist",
  description: "Log in to your Let's Assist account and start connecting with volunteer opportunities.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { redirect?: string }
}) {
  return <LoginClient redirectPath={searchParams.redirect} />;
}
