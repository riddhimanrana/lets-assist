"use client";

import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const HoverGradientButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <span className="group inline-block rounded-full p-[1.5px] bg-[linear-gradient(90deg,theme(colors.primary.DEFAULT/_60%),theme(colors.emerald.400/_60%),theme(colors.primary.DEFAULT/_60%))] [background-size:200%_100%] transition-[background-position,transform] duration-500 hover:[background-position:100%_0]">
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
