import * as React from "react";

import { cn } from "@/lib/utils";
import { MAIN_CONTENT_ID } from "./content-targets";
import { SkipToContentLink } from "./SkipToContentLink";

/**
 * The shared root `<main>`: every App Router
 * page, nested layout and client component sits inside it, so none of them may
 * add another. Use a `div` for page wrappers. `tabIndex={-1}` lets the skip
 * link move focus here without adding a Tab stop.
 *
 * Responses that are not rendered through the root layout are outside this
 * boundary and own their landmark: the CSF unsubscribe route handler returns a
 * whole HTML document with its own `<main>`. Embedded plugin markup is
 * reviewed separately in its private repository.
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
