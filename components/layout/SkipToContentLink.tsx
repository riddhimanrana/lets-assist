"use client";

import { usePathname } from "next/navigation";

import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import { MAIN_CONTENT_ID, PAGE_CONTENT_ID } from "./content-targets";

/** Native anchor targets page content after account/admin navigation. */
export function SkipToContentLink() {
  const pathname = usePathname();
  const target = /^\/(?:account|admin)(?:\/|$)/u.test(pathname ?? "")
    ? PAGE_CONTENT_ID
    : MAIN_CONTENT_ID;
  return (
    <a
      href={`#${target}`}
      data-slot="skip-to-content"
      className={cn(
        buttonVariants({ variant: "outline" }),
        "fixed top-3 left-3 z-50 h-9 -translate-y-20 px-4 focus:translate-y-0 motion-reduce:transition-none",
      )}
    >
      Skip to content
    </a>
  );
}
