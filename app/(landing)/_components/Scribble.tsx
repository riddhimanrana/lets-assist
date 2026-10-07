import { cn } from "@/lib/utils";

type ScribbleProps = {
  children: React.ReactNode;
  className?: string;
};

/** Handwritten margin note. The one decorative voice on the landing page. */
export function Scribble({ children, className }: ScribbleProps) {
  return (
    <p
      className={cn(
        "font-cheese-milky m-0 text-2xl leading-none text-foreground sm:text-3xl",
        className,
      )}
    >
      {children}
    </p>
  );
}

type ScribbleArrowProps = {
  className?: string;
};

export function ScribbleArrow({ className }: ScribbleArrowProps) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 96 64"
      fill="none"
      className={cn("h-12 w-16 text-foreground", className)}
    >
      <path
        d="M6 54C30 58 62 44 84 12"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M84 12C76 14 69 18 63 24M84 12C85 21 85 29 83 37"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
