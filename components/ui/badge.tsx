import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "h-5 gap-1 rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium transition-all has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:size-3! inline-flex items-center justify-center w-fit whitespace-nowrap shrink-0 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive overflow-hidden group/badge",
  {
    variants: {
      variant: {
        default:
          "bg-primary bg-[image:var(--button-primary-gloss)] text-primary-foreground shadow-(--button-primary-shadow) [a]:hover:brightness-105",
        secondary:
          "bg-secondary bg-[image:var(--control-gloss)] text-secondary-foreground shadow-(--control-shadow) [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 [a]:hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 text-destructive dark:bg-destructive/20",
        outline:
          "border-border bg-[image:var(--control-gloss)] text-foreground shadow-(--control-shadow) [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        info: "bg-info/10 text-info border-info/20 [a]:hover:bg-info/20",
        success:
          "bg-success/10 text-success border-success/20 [a]:hover:bg-success/20",
        warning:
          "bg-warning/10 text-warning border-warning/25 [a]:hover:bg-warning/20",
        // A state that is not good, bad or pending: not connected, not set
        // up, draft, inactive. Flat like the other statuses, with no tone.
        neutral:
          "bg-muted text-muted-foreground border-border [a]:hover:bg-muted/70",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ className, variant })),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge, badgeVariants };
