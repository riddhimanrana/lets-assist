
import React from "react";
import Link from "next/link";
import { format } from "date-fns";
import { MapPin } from "lucide-react";

import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
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
    actionLabel?: string;
    actionVariant?: "default" | "secondary" | "outline" | "ghost" | "link";
    topLeftBadge?: React.ReactNode;
    className?: string;
    footerContent?: React.ReactNode;
}

export function ProjectCard({
    project,
    href,
    actionLabel = "View Project",
    actionVariant = "default",
    topLeftBadge,
    className,
    footerContent,
}: ProjectCardProps) {
    const dateDisplay = formatDateDisplay(project as unknown as Project);

    return (
        <Card className={cn("overflow-hidden flex flex-col h-full py-0 gap-0 dark:ring-0 dark:shadow-md", className)}>
            <CardHeader className="p-4 pb-2 space-y-3">
                <div className="flex justify-between items-start gap-2">
                    <div className="flex-shrink-0">
                        {topLeftBadge}
                    </div>
                    <Badge variant="outline" className="text-xs whitespace-nowrap z-10 shrink-0">
                        {dateDisplay}
                    </Badge>
                </div>
                <h3 className="font-medium text-base line-clamp-2 leading-tight pr-1" title={project.title}>
                    {project.title}
                </h3>
            </CardHeader>

            <CardContent className="p-4 pt-2 flex-grow space-y-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{project.location}</span>
                </div>

                <div className="flex items-center gap-2 pt-1">
                    <Avatar className="h-6 w-6 ring-1 ring-border/50">
                        <AvatarImage
                            src={project.organization?.logo_url || project.creator?.avatar_url || ""}
                            alt={project.organization?.name || project.creator?.full_name || ""}
                        />
                        <AvatarFallback>
                            <NoAvatar
                                className="text-[10px]"
                                fullName={project.organization?.name || project.creator?.full_name || ""}
                            />
                        </AvatarFallback>
                    </Avatar>
                    <span className="text-xs font-medium truncate text-muted-foreground">
                        {project.organization?.name || project.creator?.full_name || "Anonymous"}
                    </span>
                </div>

                {footerContent}
            </CardContent>

            <CardFooter className="p-4 pt-0 mt-auto bg-transparent border-t-0">
                <Link
                    href={href}
                    className={cn(buttonVariants({ variant: actionVariant, size: "sm" }), "w-full")}
                >
                    {actionLabel}
                </Link>
            </CardFooter>
        </Card>
    );
}
