"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { ChevronRight, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Project } from "@/types";
import { cn } from "@/lib/utils";

type Props = {
  project: Project;
  isCreator?: boolean;
  buttonClassName?: string;
  buttonVariant?: "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";
  buttonSize?: "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";
  showChevron?: boolean;
};

const ProjectInstructionsModal = dynamic(() => import("./ProjectInstructions"), {
  ssr: false,
  loading: () => null,
});

export default function ProjectInstructionsModalWrapper({
  project,
  isCreator,
  buttonClassName,
  buttonVariant,
  buttonSize,
  showChevron,
}: Props) {
  const Label = isCreator ? "Creator Guide" : "How It Works";
  const size = buttonSize ?? (isCreator ? "default" : "sm");
  const variant = buttonVariant ?? "outline";
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return (
      <Button
        variant={variant}
        size={size}
        className={cn("gap-2", showChevron && "justify-between", buttonClassName)}
        disabled
      >
        <span className="flex items-center gap-2">
          <HelpCircle className="h-4 w-4" />
          {Label}
        </span>
        {showChevron && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </Button>
    );
  }

  return (
    <ProjectInstructionsModal
      project={project}
      isCreator={isCreator}
      buttonClassName={buttonClassName}
      buttonVariant={variant}
      buttonSize={size}
      showChevron={showChevron}
    />
  );
}
