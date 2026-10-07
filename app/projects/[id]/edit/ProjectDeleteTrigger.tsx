"use client";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
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
      className="w-full sm:w-auto"
      disabled={!hydrated || isDeleting || !canDelete}
    >
      {isDeleting ? <Spinner data-icon="inline-start" /> : null}
      Delete project
    </Button>
  );
}
