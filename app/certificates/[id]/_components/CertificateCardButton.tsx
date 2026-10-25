import { ExternalLink } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

interface CertificateCardButtonProps {
  projectId?: string | null;
}

export function CertificateCardButton({
  projectId,
}: CertificateCardButtonProps) {
  if (!projectId) {
    return (
      <Button variant="outline" disabled>
        Project unavailable
      </Button>
    );
  }

  return (
    <Link
      href={`/projects/${projectId}`}
      className={cn(buttonVariants({ variant: "outline" }))}
    >
      View project details
      <ExternalLink data-icon="inline-end" aria-hidden="true" />
    </Link>
  );
}
