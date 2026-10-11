import * as React from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

/** The skip link's target. Only the root layout's `<main>` carries this id. */
const MAIN_CONTENT_ID = "main-content";

/**
 * The first keyboard stop on every page. It is parked above the viewport until
 * it takes focus, then sits over the top-left corner so a keyboard user can
 * jump past the banner and navigation.
 */
function SkipToContentLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
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

/**
 * The one `<main>` for everything the root layout renders: every App Router
 * page, nested layout and client component sits inside it, so none of them may
 * add another. Use a `div` for page wrappers. `tabIndex={-1}` lets the skip
 * link move focus here without adding a Tab stop.
 *
 * Responses that are not rendered through the root layout are outside this
 * boundary and own their landmark: the CSF unsubscribe route handler returns a
 * whole HTML document with its own `<main>`.
 */
function MainContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      className={cn("flex-1 w-full outline-none", className)}
    >
      {children}
    </main>
  );
}

export { MAIN_CONTENT_ID, MainContent, SkipToContentLink };
