import { FolderKanban } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";

import type { OrganizationReportData } from "./actions";

function formatProjectStatusLabel(status: string | null | undefined) {
  if (!status) return "Unknown";

  const label = status.replace(/[_-]+/g, " ").trim().toLowerCase();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function getProjectStatusBadgeVariant(
  status: string | null | undefined,
): "success" | "destructive" | "outline" {
  switch ((status || "").toLowerCase()) {
    case "completed":
      return "success";
    case "cancelled":
      return "destructive";
    default:
      return "outline";
  }
}

/** The three projects with the most logged hours in the selected range. */
export function ReportsTopProjects({
  projects,
  loading,
}: {
  projects: OrganizationReportData["projects"];
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top projects by hours</CardTitle>
        <CardDescription>Top 3 projects by total hours logged</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : projects.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderKanban />
              </EmptyMedia>
              <EmptyTitle>No project hours yet</EmptyTitle>
              <EmptyDescription>
                Projects appear here once volunteers log hours in this range.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="gap-0">
            {projects.map((project, index) => (
              <div key={project.id}>
                {index > 0 ? <ItemSeparator className="my-0" /> : null}
                <Item size="sm" className="px-0">
                  <ItemContent className="min-w-0">
                    <ItemTitle className="w-full">
                      <span className="truncate">{project.title}</span>
                    </ItemTitle>
                    <Badge
                      variant={getProjectStatusBadgeVariant(project.status)}
                    >
                      {formatProjectStatusLabel(project.status)}
                    </Badge>
                  </ItemContent>
                  <ItemActions>
                    <span className="text-sm font-semibold tabular-nums">
                      {(project.totalHours ?? 0).toFixed(1)}h
                    </span>
                  </ItemActions>
                </Item>
              </div>
            ))}
          </ItemGroup>
        )}
      </CardContent>
    </Card>
  );
}
