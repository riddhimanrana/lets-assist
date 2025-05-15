import { Metadata } from "next";
import ErrorClient from "./ErrorClient";

export const metadata: Metadata = {
  title: "Error",
  description: "An error occurred. Please try again or contact support.",
};

export default function ErrorPage() {
  return <ErrorClient />;
}
