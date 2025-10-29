import { redirect } from 'next/navigation';
import { canViewOrgModeration } from '@/utils/admin-helpers';
import { getOrgModerationStats, getOrgFlaggedContent } from './actions';
import OrgModerationDashboard from './OrgModerationDashboard';

export const metadata = {
  title: 'Content Moderation | Organization',
  description: 'Organization content moderation dashboard',
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
  
  // Fetch initial data
  const [stats, flaggedContent] = await Promise.all([
    getOrgModerationStats(organizationId),
    getOrgFlaggedContent(organizationId, 'pending_review'),
  ]);
  
  if (stats.error || flaggedContent.error) {
    return (
      <div className="container mx-auto max-w-7xl px-4 py-8">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-destructive">
          <p className="font-medium">Error loading moderation data</p>
          <p className="mt-2 text-sm opacity-90">
            {stats.error || flaggedContent.error}
          </p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="container mx-auto max-w-7xl py-6 md:py-8">
      <div className="mb-6 space-y-2 px-4 md:mb-8 md:px-0">
        <h1 className="text-2xl font-bold md:text-3xl">Organization Moderation</h1>
        <p className="text-sm text-muted-foreground md:text-base">
          Review and manage flagged content for your organization
        </p>
      </div>
      
      <OrgModerationDashboard
        organizationId={organizationId}
        initialStats={stats.data!}
        initialFlagged={flaggedContent.data || []}
      />
    </div>
  );
}
