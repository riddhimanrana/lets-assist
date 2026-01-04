import { redirect } from 'next/navigation';
import { checkSuperAdmin } from '../actions';
import ModerationDashboard from './ModerationDashboardWrapper';
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
    <ModerationDashboard 
      initialStats={stats.data!}
      initialFlagged={flaggedContent.data || []}
      initialReports={contentReports.data || []}
      initialReportsStats={reportsStats.data!}
    />
  );
}
