"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Project } from "@/types";

type Props = {
  project: Project;
  isCreator?: boolean;
};

const ProjectInstructionsModal = dynamic(() => import("./ProjectInstructions"), {
  ssr: false,
  loading: () => null,
});

export default function ProjectInstructionsModalWrapper({ project, isCreator }: Props) {
  const Label = isCreator ? "Creator Guide" : "How It Works";
  const size = isCreator ? "default" : "sm";
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return (
      <Button variant="outline" size={size} className="gap-2" disabled>
        <HelpCircle className="h-4 w-4" />
        {Label}
      </Button>
    );
  }

  return <ProjectInstructionsModal project={project} isCreator={isCreator} />;
}
