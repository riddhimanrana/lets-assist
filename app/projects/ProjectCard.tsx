import React from "react";
import Link from "next/link";
import { Calendar, MapPin } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NoAvatar } from "@/components/shared/NoAvatar";
import { cn } from "@/lib/utils";
import { Project } from "@/types";
import { formatDateDisplay } from "@/utils/project";

interface ProjectWithCreator extends Omit<Project, "organization"> {
  creator?: {
    id: string;
    full_name: string;
    avatar_url: string | null;
    username: string;
  };
  // Optional extra fields that might come from joins
  organization?: {
    name: string;
    logo_url?: string | null;
    username: string;
  };
}

interface ProjectCardProps {
  project: ProjectWithCreator;
  href: string;
  /** One status or count shown above the title. */
  badge?: React.ReactNode;
  className?: string;
  /** One extra fact row under date and place. */
  footerContent?: React.ReactNode;
  showIdentity?: boolean;
}

/**
 * A project the signed-in user volunteers for or runs. The whole card is the
 * link. Order is fixed: status, title, who runs it, date, place.
 */
export function ProjectCard({
  project,
  href,
  badge,
  className,
  footerContent,
  showIdentity = true,
}: ProjectCardProps) {
  const dateDisplay = formatDateDisplay(project as unknown as Project);
  const hostName =
    project.organization?.name || project.creator?.full_name || "Anonymous";

  return (
    <Link
      href={href}
      className="group/project-card focus-visible:ring-ring/50 block h-full rounded-xl outline-none focus-visible:ring-[3px]"
    >
      <Card
        className={cn(
          "group-hover/project-card:ring-foreground/25 h-full gap-3 transition-shadow",
          className,
        )}
      >
        <div className="grid gap-1.5 px-4">
          {badge ? <div className="mb-0.5 flex">{badge}</div> : null}
          <h3
            className="line-clamp-2 min-h-11 text-base leading-snug font-semibold"
            title={project.title}
          >
            {project.title}
          </h3>
          {showIdentity && (
            <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm">
              <Avatar className="size-5">
                <AvatarImage
                  src={
                    project.organization?.logo_url ||
                    project.creator?.avatar_url ||
                    ""
                  }
                  alt=""
                />
                <AvatarFallback>
                  <NoAvatar className="text-xs" fullName={hostName} />
                </AvatarFallback>
              </Avatar>
              <span className="truncate">{hostName}</span>
            </div>
          )}
        </div>

        <div className="mt-auto grid gap-1.5 border-t px-4 pt-3 text-sm">
          <div className="flex items-center gap-2">
            <Calendar
              className="text-muted-foreground size-4 shrink-0"
              aria-hidden="true"
            />
            <span className="truncate">{dateDisplay}</span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin
              className="text-muted-foreground size-4 shrink-0"
              aria-hidden="true"
            />
            <span className="truncate">{project.location}</span>
          </div>
          {footerContent}
        </div>
      </Card>
    </Link>
  );
}
