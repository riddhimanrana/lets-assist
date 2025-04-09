import { Metadata } from "next";
import LoginClient from "./LoginClient";

export const metadata: Metadata = {
  title: "Login - Let's Assist",
  description:
    "Log in to your Let's Assist account and start connecting with volunteer opportunities.",
};

type Props = {
  params: Promise<{ redirect: string }>;
};

export default async function LoginPage({ params }: Props) {
  const { redirect } = await params;
  return <LoginClient redirectPath={redirect ?? ""} />;
}
