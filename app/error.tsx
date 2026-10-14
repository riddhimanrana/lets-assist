"use client"; // Error boundaries must be Client Components

import Link from "next/link";

import { PAGE_CONTENT_ID } from "@/components/layout/content-targets";
import { NoticePage } from "@/components/projects/NoticePage";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

/**
 * The fallback for an uncaught error in any route under the root layout. The
 * copy is fixed: an error message or digest can carry record contents, so
 * neither is rendered or logged here. The root layout already owns the main landmark.
 */
export default function RootError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div id={PAGE_CONTENT_ID} tabIndex={-1} className="outline-none">
      <NoticePage
        title="Something went wrong"
        description="This page could not load. Try again, or return home."
        actions={
          <>
            <Button type="button" onClick={() => retry()}>
              Try again
            </Button>
            <Link
              href="/"
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              Return home
            </Link>
          </>
        }
      />
    </div>
  );
}
