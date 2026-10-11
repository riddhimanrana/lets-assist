"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type MotionLinkButtonProps = {
  href: string;
  children: React.ReactNode;
  tone?: "solid" | "outline";
  className?: string;
};

export function MotionLinkButton({
  href,
  children,
  tone = "solid",
  className,
}: MotionLinkButtonProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    // Motion gives an element with `whileTap` tabIndex 0 unless one is set.
    // The server cannot know the motion preference, so it renders the gesture
    // and a reduced-motion client does not, and the attribute would differ.
    // Setting it keeps both renders the same and leaves the link as the only
    // keyboard stop.
    <motion.div
      className="w-full sm:w-auto"
      tabIndex={-1}
      initial={false}
      whileHover={shouldReduceMotion ? undefined : "hover"}
      whileTap={shouldReduceMotion ? undefined : "tap"}
    >
      <Button
        asChild
        variant={tone === "solid" ? "default" : "outline"}
        className={cn(
          "group relative h-11 w-full overflow-hidden rounded-full px-5 sm:w-auto",
          className,
        )}
      >
        <Link href={href}>
          <span className="relative grid h-full place-items-center overflow-hidden">
            <motion.span
              className="inline-flex items-center gap-2"
              variants={{
                hover: { y: "-140%" },
                tap: { y: "-140%" },
              }}
              transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
            >
              {children}
            </motion.span>
            <motion.span
              aria-hidden
              className="absolute inline-flex items-center gap-2"
              initial={{ y: "140%" }}
              variants={{
                hover: { y: 0 },
                tap: { y: 0 },
              }}
              transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
            >
              {children}
            </motion.span>
          </span>
        </Link>
      </Button>
    </motion.div>
  );
}
