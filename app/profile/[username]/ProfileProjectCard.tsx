import Link from "next/link";
import { format } from "date-fns";
import { BadgeCheck, CalendarIcon, MapPin, Users } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ProjectStatusBadge } from "@/components/ui/status-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { stripHtml } from "@/lib/utils";
import type { Project } from "./profile-page-data";

/** Compact project card used only on the public profile. */
export function ProfileProjectCard({
  project,
  type,
  isTrusted,
}: {
  project: Project;
  type: "created" | "attended";
  isTrusted: boolean;
}) {
  return (
    <Link
      href={`/projects/${project.id}`}
      className="focus-visible:ring-ring/50 block h-full rounded-xl outline-none focus-visible:ring-[3px]"
    >
      <Card className="hover:bg-muted/40 h-full transition-colors">
        <CardHeader>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <CardTitle className="truncate">{project.title}</CardTitle>
              {type === "created" && isTrusted && (
                <Tooltip>
                  <TooltipTrigger
                    render={<span className="inline-flex shrink-0" />}
                  >
                    <BadgeCheck
                      className="text-primary size-4"
                      aria-label="Verified project"
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>Verified project</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <ProjectStatusBadge
              status={project.status}
              size="sm"
              className="shrink-0"
            />
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3">
          <CardDescription className="line-clamp-2 break-words">
            {stripHtml(project.description)}
          </CardDescription>
          <div className="text-muted-foreground mt-auto grid gap-1 text-sm">
            <div className="flex items-center gap-1.5">
              <MapPin className="size-3.5 shrink-0" />
              <span className="truncate">{project.location}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {type === "created" ? (
                <>
                  <CalendarIcon className="size-3.5 shrink-0" />
                  <span>
                    Created{" "}
                    {format(new Date(project.created_at), "MMM d, yyyy")}
                  </span>
                </>
              ) : (
                <>
                  <Users className="size-3.5 shrink-0" />
                  <span>Attended</span>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
