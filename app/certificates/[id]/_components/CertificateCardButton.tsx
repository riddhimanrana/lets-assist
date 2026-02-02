"use client";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CardItem } from "@/components/ui/3d-card";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

interface CertificateCardButtonProps {
  projectId?: string | null;
  translateZ?: number;
}

export function CertificateCardButton({ projectId, translateZ = 40 }: CertificateCardButtonProps) {
  if (!projectId) {
    return (
      <Button variant="outline" size="sm" disabled className="ml-auto">
        Project Unavailable
      </Button>
    );
  }

  return (
    <CardItem translateZ={translateZ} className="ml-auto">
      <Link href={`/projects/${projectId}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "backdrop-blur-xs flex items-center gap-1.5")}>
        View Project Details
        <ExternalLink className="h-3.5 w-3.5" />
      </Link>
    </CardItem>
  );
}
