"use client";

import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";

import { cn } from "@/lib/utils";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";

function Accordion({ className, ...props }: AccordionPrimitive.Root.Props) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn("flex w-full flex-col", className)}
      {...props}
    />
  );
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("not-last:border-b", className)}
      {...props}
    />
  );
}

function AccordionTrigger({
  className,
  children,
  ...props
}: AccordionPrimitive.Trigger.Props) {
  return (
    <AccordionPrimitive.Header className="flex min-w-0">
      {/* `min-w-0` is load-bearing: the trigger is a `flex-1` flex item, so
          without it the automatic minimum size pins it to the min-content width
          of its own children. A collapsed trigger whose summary line uses
          `truncate` (white-space: nowrap) then reports the full untruncated
          text width, overflows the header, and widens the document instead of
          ellipsising. */}
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "focus-visible:ring-ring/50 focus-visible:border-ring focus-visible:after:border-ring **:data-[slot=accordion-trigger-icon]:text-muted-foreground rounded-md py-4 text-left text-sm font-medium hover:underline focus-visible:ring-[3px] **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-4 group/accordion-trigger relative flex min-w-0 flex-1 items-start justify-between border border-transparent transition-all outline-none disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon
          data-slot="accordion-trigger-icon"
          className="pointer-events-none shrink-0 group-aria-expanded/accordion-trigger:hidden"
        />
        <ChevronUpIcon
          data-slot="accordion-trigger-icon"
          className="pointer-events-none hidden shrink-0 group-aria-expanded/accordion-trigger:inline"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

function AccordionContent({
  className,
  children,
  ...props
}: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-content"
      className="data-open:animate-accordion-down data-closed:animate-accordion-up text-sm overflow-hidden"
      {...props}
    >
      <div
        className={cn(
          // Prose links inside an accordion answer read better underlined, but
          // the rule used to hit EVERY descendant anchor -- including links
          // rendered as buttons and tab bars, which came out underlined like
          // debug output. Anything carrying a `data-slot` is a styled control,
          // not prose, so it keeps its own affordance.
          //
          // The exclusion is wrapped in `:where()` deliberately. A bare
          // `:not([data-slot])` adds a class-level weight, which pushed this
          // rule past the `[&_a]:no-underline` escape hatch consumers already
          // use (CsfClassTerms) and silently re-underlined them. `:where()`
          // contributes zero specificity, so this stays exactly as easy to
          // override as it was before the exclusion existed.
          "pt-0 pb-4 [&_a:where(:not([data-slot]))]:hover:text-foreground h-(--accordion-panel-height) data-ending-style:h-0 data-starting-style:h-0 [&_a:where(:not([data-slot]))]:underline [&_a:where(:not([data-slot]))]:underline-offset-3 [&_p:not(:last-child)]:mb-4",
          className,
        )}
      >
        {children}
      </div>
    </AccordionPrimitive.Panel>
  );
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
