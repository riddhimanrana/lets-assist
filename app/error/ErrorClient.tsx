"use client";

import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { NoticePage } from "@/components/projects/NoticePage";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

export default function ErrorClient() {
  const searchParams = useSearchParams();
  const [hashErrorDescription, setHashErrorDescription] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!window.location.hash) {
      return;
    }

    const params = new URLSearchParams(window.location.hash.substring(1));
    const description = params.get("error_description");
    setHashErrorDescription(description);
  }, []);

  const message =
    searchParams.get("message") ||
    hashErrorDescription ||
    "There was a problem with the link.";

  return (
    <NoticePage
      icon={<CircleAlert aria-hidden="true" />}
      tone="destructive"
      title="Authentication error"
      description="Please try again or contact support if the issue persists."
      actions={
        <>
          <Link href="/login" className={buttonVariants()}>
            Back to login
          </Link>
          <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
            Go to home
          </Link>
        </>
      }
    >
      <p
        className="bg-muted rounded-md px-3 py-2 text-sm wrap-break-word"
        role="alert"
      >
        {message}
      </p>
    </NoticePage>
  );
}
