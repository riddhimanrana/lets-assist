import { notFound } from "next/navigation";
import { WaiverBuilderHarnessClient } from "./WaiverBuilderHarnessClient";

export default function WaiverBuilderHarnessPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <WaiverBuilderHarnessClient />;
}
