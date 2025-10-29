import { redirect } from "next/navigation";
import { checkSuperAdmin, getAllFeedback, getTrustedMemberApplications } from "./actions";
import { getModerationStats, getFlaggedContent, getContentReports, getContentReportsStats } from "./moderation/actions";
import { AdminClient } from "./AdminClient";

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
  const [feedbackResult, applicationsResult, moderationStats, flaggedContent, contentReports, reportsStats] = await Promise.all([
    getAllFeedback(),
    getTrustedMemberApplications(),
    getModerationStats(),
    getFlaggedContent('pending'),
    getContentReports('pending'),
    getContentReportsStats(),
  ]);

  const feedback = feedbackResult.data || [];
  const applications = applicationsResult.data || [];
  const stats = moderationStats.data;
  const flags = flaggedContent.data || [];
  const reports = contentReports.data || [];
  const reportStats = reportsStats.data;

  // Check for errors
  const hasErrors = feedbackResult.error || applicationsResult.error || moderationStats.error || flaggedContent.error || contentReports.error || reportsStats.error;

  if (hasErrors) {
    return (
      <div className="container mx-auto max-w-7xl px-4 py-8">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-destructive">
          <p className="font-medium">Error loading admin data</p>
          <p className="mt-2 text-sm opacity-90">
            {feedbackResult.error || applicationsResult.error || moderationStats.error || flaggedContent.error || contentReports.error || reportsStats.error}
          </p>
        </div>
      </div>
    );
  }

  return (
    <AdminClient 
      feedback={feedback} 
      applications={applications}
      moderationStats={stats}
      flaggedContent={flags}
      contentReports={reports}
      reportsStats={reportStats}
    />
  );
}
