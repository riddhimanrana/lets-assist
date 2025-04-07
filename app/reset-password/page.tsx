import { Metadata } from "next";
import ResetPasswordClient from "./ResetPasswordClient";

export const metadata: Metadata = {
  title: "Set New Password - Let's Assist",
  description: "Set a new password for your Let's Assist account.",
};

export default function ResetPasswordPage() {
  return <ResetPasswordClient />;
}
