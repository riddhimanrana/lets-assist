import Link from "next/link";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

/** The way back from an organizer tool to the project it belongs to. */
export function ProjectToolBreadcrumb({
  projectId,
  projectTitle,
  current,
}: {
  projectId: string;
  projectTitle?: string | null;
  current: string;
}) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem className="min-w-0">
          <BreadcrumbLink
            className="max-w-56 truncate sm:max-w-sm"
            render={<Link href={`/projects/${projectId}`} />}
          >
            {projectTitle || "Project"}
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{current}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
