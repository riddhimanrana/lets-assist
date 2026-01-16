import { Metadata } from "next";
import VerificationSuccessClient from "./VerificationSuccessClient";

export const metadata: Metadata = {
  title: "Verification Success",
  description: "Your email has been successfully verified.",
};

export default function VerificationSuccessPage() {
  return <VerificationSuccessClient />;
}
