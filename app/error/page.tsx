import { Metadata } from "next";
import ErrorClient from "./ErrorClient";

export const metadata: Metadata = {
  title: "Error",
  description: "An error occurred. Please try again or contact support.",
};

import { Suspense } from "react";

export default function ErrorPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ErrorClient />
    </Suspense>
  );
}
