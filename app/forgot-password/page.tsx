import { Metadata } from "next";
import ForgotPasswordClient from "./ForgotPasswordClient";

export const metadata: Metadata = {
  title: "Reset Password - Let's Assist",
  description: "Reset your Let's Assist account password.",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordClient />;
}
