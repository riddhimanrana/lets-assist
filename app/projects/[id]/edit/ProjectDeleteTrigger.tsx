"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/hooks/useHydrated";

type Props = {
  canDelete: boolean;
  isDeleting: boolean;
  onDeleteRequested: () => void;
};

export function ProjectDeleteTrigger({
  canDelete,
  isDeleting,
  onDeleteRequested,
}: Props) {
  const hydrated = useHydrated();
  return (
    <Button
      onClick={onDeleteRequested}
      className="w-full bg-destructive text-background hover:bg-destructive/90"
      disabled={!hydrated || isDeleting || !canDelete}
    >
      {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
      Delete Project
    </Button>
  );
}
