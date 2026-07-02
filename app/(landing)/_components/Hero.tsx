"use client";

import { HeroContent } from "./HeroContent";

export const Hero = () => {
  return (
    <div className="relative isolate overflow-hidden border-b bg-background text-foreground">
      <div className="relative z-10 flex flex-col gap-0">
        <HeroContent />
      </div>
    </div>
  );
};
