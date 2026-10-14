"use client";

import { HeroContent } from "./HeroContent";

export const Hero = ({ demoDateAnchor }: { demoDateAnchor: string }) => {
  return (
    <div
      data-demo-date-anchor={demoDateAnchor}
      className="relative isolate overflow-hidden border-b bg-background text-foreground"
    >
      <div className="relative z-10 flex flex-col gap-0">
        <HeroContent demoDateAnchor={demoDateAnchor} />
      </div>
    </div>
  );
};
