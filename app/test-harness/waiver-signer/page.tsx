import { notFound } from "next/navigation";
import { WaiverSignerHarnessClient } from "./WaiverSignerHarnessClient";

export default function WaiverSignerHarnessPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <WaiverSignerHarnessClient />;
}
