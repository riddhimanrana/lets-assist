import { redirect } from 'next/navigation';
import { checkSuperAdmin } from '../actions';
import ModerationDashboard from './ModerationDashboard';
import { getModerationStats, getFlaggedContent, getContentReports, getContentReportsStats } from './actions';

export const metadata = {
  title: 'Content Moderation | Admin',
  description: 'Platform-wide content moderation dashboard',
};

export default async function AdminModerationPage() {
  // Check admin access
  const { isAdmin } = await checkSuperAdmin();
  
  if (!isAdmin) {
    redirect('/not-found');
  }
  
  // Fetch initial data
  const [stats, flaggedContent, contentReports, reportsStats] = await Promise.all([
    getModerationStats(),
    getFlaggedContent('pending'),
    getContentReports('pending'),
    getContentReportsStats(),
  ]);
  
  if (stats.error || flaggedContent.error || contentReports.error || reportsStats.error) {
    return (
      <div className="container mx-auto max-w-7xl px-4 py-8">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-destructive">
          <p className="font-medium">Error loading moderation data</p>
          <p className="mt-2 text-sm opacity-90">
            {stats.error || flaggedContent.error || contentReports.error || reportsStats.error}
          </p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="container mx-auto max-w-7xl py-6 md:py-8">
      <div className="mb-6 space-y-2 px-4 md:mb-8 md:px-0">
        <h1 className="text-2xl font-bold md:text-3xl">Content Moderation</h1>
        <p className="text-sm text-muted-foreground md:text-base">
          Review and manage flagged content and user reports across the platform
        </p>
      </div>
      
      <ModerationDashboard 
        initialStats={stats.data!}
        initialFlagged={flaggedContent.data || []}
        initialReports={contentReports.data || []}
        initialReportsStats={reportsStats.data!}
      />
    </div>
  );
}
