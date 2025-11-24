import { redirect } from "next/navigation";
import { checkSuperAdmin, getAllFeedback, getTrustedMemberApplications } from "./actions";
import { getModerationStats, getFlaggedContent, getContentReports, getContentReportsStats } from "./moderation/actions";
import { OverviewTab } from "./components/OverviewTab";

export const metadata = {
  title: "Admin Dashboard | Let's Assist",
  description: "Unified admin dashboard for managing feedback, trusted members, and content moderation",
};

export default async function AdminPage() {
  // Check if user is super admin
  const { isAdmin } = await checkSuperAdmin();
  
  if (!isAdmin) {
    redirect("/not-found");
  }

  // Fetch all admin data in parallel
  const [
    feedbackResult,
    applicationsResult,
    moderationStats,
    flaggedContent,
    pendingReports,
    reportsStats,
    underReviewReports,
  ] = await Promise.all([
    getAllFeedback(),
    getTrustedMemberApplications(),
    getModerationStats(),
    getFlaggedContent('pending'),
    getContentReports('pending'),
    getContentReportsStats(),
    getContentReports('under_review'),
  ]);

  const stats = moderationStats.data;
  const aggregateReportStats = reportsStats.data ?? {
    total: 0,
    pending: 0,
    resolved: 0,
    highPriority: 0,
    recentWeek: 0,
  };

  const firstError = feedbackResult.error
    || applicationsResult.error
    || moderationStats.error
    || flaggedContent.error
    || pendingReports.error
    || reportsStats.error
    || underReviewReports.error;

  if (firstError) {
    return (
      <div className="container mx-auto max-w-7xl px-4 py-8">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-destructive">
          <p className="font-medium">Error loading admin data</p>
          <p className="mt-2 text-sm opacity-90">
            {firstError}
          </p>
        </div>
      </div>
    );
  }

  const flaggedContentData = flaggedContent.data || [];
  const pendingReportData = pendingReports.data || [];
  const underReviewReportData = underReviewReports.data || [];
  const reportPreview = [...pendingReportData, ...underReviewReportData].slice(0, 4);

  // Calculate stats for the overview
  const overviewStats = {
    feedbackCount: feedbackResult.data?.length || 0,
    trustedPendingCount: applicationsResult.data?.filter(a => a.status === null).length || 0,
    flaggedPendingCount: stats?.pending || 0,
    reportsPendingCount: aggregateReportStats.pending || 0,
  };

  return (
    <div className="container mx-auto max-w-7xl space-y-8 py-8 px-4 md:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Admin Overview</h1>
        <p className="text-muted-foreground">
          Platform activity and pending actions across feedback, trusted members, and moderation.
        </p>
      </div>
      <section className="rounded-2xl border bg-card/80 p-4 shadow-sm sm:p-6">
        <OverviewTab 
          stats={overviewStats}
          flaggedContent={flaggedContentData}
          reportPreview={reportPreview}
          reportsStats={aggregateReportStats}
        />
      </section>
    </div>
  );
}
