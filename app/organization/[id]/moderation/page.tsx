import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { createClient } from "@/lib/supabase/server";
import { canViewOrgModeration } from "@/utils/admin-helpers";
import { getOrgModerationStats, getOrgFlaggedContent } from "./actions";
import OrgModerationDashboard from "./OrgModerationDashboard";

export const metadata = {
  title: "Organization moderation",
  description: "Organization content moderation dashboard",
};

export default async function OrgModerationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const organizationId = id;

  // Check permissions
  const canView = await canViewOrgModeration(organizationId);

  if (!canView) {
    redirect(`/organization/${organizationId}`);
  }

  // Fetch initial data. The name is only for the breadcrumb, so a failed
  // lookup falls back to the generic word.
  const supabase = await createClient();
  const [stats, flaggedContent, { data: organization }] = await Promise.all([
    getOrgModerationStats(organizationId),
    getOrgFlaggedContent(organizationId, "pending_review"),
    supabase
      .from("organizations")
      .select("name, username")
      .eq("id", organizationId)
      .maybeSingle(),
  ]);
  const organizationName = organization?.name?.trim() || "Organization";
  const organizationHref = `/organization/${organization?.username || organizationId}`;

  const header = (
    <PageHeader
      breadcrumb={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/organization" />}>
                Organizations
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href={organizationHref} />}>
                {organizationName}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Moderation</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
      title="Moderation"
      description="Review content flagged in your organization"
    />
  );

  if (stats.error || flaggedContent.error) {
    return (
      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 sm:px-6">
        {header}
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Error loading moderation data</AlertTitle>
          <AlertDescription>
            {stats.error || flaggedContent.error}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 sm:px-6">
      {header}

      <OrgModerationDashboard
        organizationId={organizationId}
        initialStats={stats.data!}
        initialFlagged={flaggedContent.data || []}
      />
    </div>
  );
}
