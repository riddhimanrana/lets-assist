"use client";

import type { ReactNode } from "react";
import {
  BadgeCheck,
  Building2,
  Calendar,
  Flag,
  MapPin,
  MoreVertical,
  Share2,
  User,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectStatusBadge } from "@/components/ui/status-badge";
import type { ProjectStatus } from "@/types";

/**
 * The top of a project page: its state, its name, then when, where and who
 * runs it on one aligned block. Share and report sit to the right.
 */
export function ProjectDetailsHeader({
  title,
  status,
  when,
  location,
  hostName,
  hostIsOrganization,
  hostVerified,
  primaryAction,
  onShare,
  onReport,
}: {
  title: string;
  status: ProjectStatus;
  when: string;
  location: string;
  hostName: string;
  hostIsOrganization: boolean;
  hostVerified: boolean;
  primaryAction?: ReactNode;
  onShare: () => void;
  /** Omit for people who manage the project. */
  onReport?: () => void;
}) {
  const HostIcon = hostIsOrganization ? Building2 : User;

  return (
    <header className="mb-6 grid gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-2">
          <ProjectStatusBadge status={status} className="w-fit capitalize" />
          <h1 className="text-2xl font-semibold tracking-tight text-balance wrap-break-word">
            {title}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {primaryAction}
          <Button
            variant="outline"
            size="icon"
            onClick={onShare}
            aria-label="Share project"
          >
            <Share2 aria-hidden="true" />
          </Button>
          {onReport ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    suppressHydrationWarning
                  >
                    <MoreVertical aria-hidden="true" />
                    <span className="sr-only">More options</span>
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onReport}>
                  <Flag aria-hidden="true" />
                  Report project
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      <dl className="grid gap-2 text-sm sm:flex sm:flex-wrap sm:gap-x-6">
        {when ? (
          <div className="flex items-center gap-2">
            <dt className="shrink-0">
              <Calendar
                className="text-muted-foreground size-4"
                aria-hidden="true"
              />
              <span className="sr-only">When</span>
            </dt>
            <dd>{when}</dd>
          </div>
        ) : null}
        <div className="flex min-w-0 items-center gap-2">
          <dt className="shrink-0">
            <MapPin
              className="text-muted-foreground size-4"
              aria-hidden="true"
            />
            <span className="sr-only">Where</span>
          </dt>
          <dd className="min-w-0 wrap-break-word">{location}</dd>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <dt className="shrink-0">
            <HostIcon
              className="text-muted-foreground size-4"
              aria-hidden="true"
            />
            <span className="sr-only">Run by</span>
          </dt>
          <dd className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{hostName}</span>
            {hostVerified ? (
              <BadgeCheck
                className="text-success size-4 shrink-0"
                aria-label="Verified organization"
              />
            ) : null}
          </dd>
        </div>
      </dl>
    </header>
  );
}
