"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export function CardSpotlight({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState({ x: 0, y: 0 });

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      className={cn("relative", className)}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-0 md:opacity-100"
        style={{
          background: `radial-gradient(220px 220px at ${pos.x}px ${pos.y}px, hsl(var(--primary)/0.18), transparent 60%)`,
          transition: "background-position 150ms ease-out",
        }}
      />
      {children}
    </div>
  );
}
