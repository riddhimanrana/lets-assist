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
    <div className="container mx-auto max-w-7xl space-y-8 py-8 px-4 md:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Content Moderation</h1>
        <p className="text-muted-foreground">
          Review and manage flagged content and user reports across the platform.
        </p>
      </div>

      <section className="rounded-2xl border bg-card/80 p-4 shadow-sm sm:p-6">
        <ModerationDashboard 
          initialStats={stats.data!}
          initialFlagged={flaggedContent.data || []}
          initialReports={contentReports.data || []}
          initialReportsStats={reportsStats.data!}
        />
      </section>
    </div>
  );
}
