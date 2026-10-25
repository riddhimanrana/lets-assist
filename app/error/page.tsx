import { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import ErrorClient from "./ErrorClient";

export const metadata: Metadata = {
  title: "Error",
  description: "An error occurred. Please try again or contact support.",
};

export default function ErrorPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center gap-3 px-4 sm:px-6">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-full" />
        </div>
      }
    >
      <ErrorClient />
    </Suspense>
  );
}
