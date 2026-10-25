"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { SettingsSection } from "@/components/layout/SettingsSection";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ProjectDeleteTrigger } from "./ProjectDeleteTrigger";

function DangerRow({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="grid gap-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-muted-foreground max-w-prose text-sm">
          {description}
        </p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

/** Cancelling and deleting, kept apart from the form and its Save action. */
export function EditProjectDanger({
  isCancelled,
  cancellationReason,
  canDelete,
  isDeleting,
  isInDeletionRestrictionPeriod,
  onCancelProject,
  onDeleteProject,
}: {
  isCancelled: boolean;
  cancellationReason?: string | null;
  canDelete: boolean;
  isDeleting: boolean;
  isInDeletionRestrictionPeriod: boolean;
  onCancelProject: () => void;
  onDeleteProject: () => void;
}) {
  return (
    <SettingsSection
      tone="danger"
      title="Danger zone"
      description="These actions can't be undone. Please proceed with caution."
      contentClassName="gap-0 divide-y"
    >
      {isCancelled && (
        <div className="pb-4">
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>This project has been cancelled</AlertTitle>
            <AlertDescription>
              <p>
                You can still edit details, but new signups are disabled and the
                project is marked as cancelled. If this was a mistake, please
                contact{" "}
                <Link href="mailto:support@lets-assist.com">
                  support@lets-assist.com
                </Link>
              </p>
              {cancellationReason && (
                <p>
                  <span className="font-medium">Reason:</span>{" "}
                  {cancellationReason}
                </p>
              )}
            </AlertDescription>
          </Alert>
        </div>
      )}

      {!isCancelled && (
        <DangerRow
          title="Cancel project"
          description="Cancels the project and emails approved volunteers (including anonymous signups with an email address). The project remains in the system but is marked as cancelled."
          action={
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={onCancelProject}
            >
              Cancel project
            </Button>
          }
        />
      )}

      <DangerRow
        title="Delete project"
        description="Permanently removes this project and all associated data. This action cannot be undone."
        action={
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className="block w-full sm:w-auto"
                  tabIndex={canDelete ? -1 : 0}
                />
              }
            >
              <ProjectDeleteTrigger
                onDeleteRequested={onDeleteProject}
                isDeleting={isDeleting}
                canDelete={canDelete}
              />
            </TooltipTrigger>
            {isInDeletionRestrictionPeriod && (
              <TooltipContent className="max-w-64 text-center">
                <p>
                  Projects cannot be deleted during the 72-hour window around
                  the event
                </p>
              </TooltipContent>
            )}
          </Tooltip>
        }
      />
    </SettingsSection>
  );
}
