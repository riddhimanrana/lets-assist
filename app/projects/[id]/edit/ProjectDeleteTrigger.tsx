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
      variant="destructive"
      className="w-full"
      disabled={!hydrated || isDeleting || !canDelete}
    >
      {isDeleting ? (
        <Loader2 className="animate-spin" data-icon="inline-start" />
      ) : null}
      Delete project
    </Button>
  );
}
