import { notFound } from "next/navigation";
import { SonnerHarnessClient } from "./SonnerHarnessClient";

export default function SonnerHarnessPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <SonnerHarnessClient />;
}