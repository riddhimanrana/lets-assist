"use client";

import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const HoverGradientButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <span className="group inline-block rounded-full p-[1.5px] bg-[linear-gradient(90deg,--theme(--color-primary/60%),--theme(--color-emerald-400/60%),--theme(--color-primary/60%))] bg-size-[200%_100%] transition-[background-position,transform] duration-500 hover:bg-position-[100%_0]">
        <Button
          ref={ref}
          className={cn("rounded-full px-8", className)}
          {...props}
        >
          {children}
        </Button>
      </span>
    );
  }
);
HoverGradientButton.displayName = "HoverGradientButton";
