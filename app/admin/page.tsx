import { redirect } from "next/navigation";
import {
  checkSuperAdmin,
  getAllFeedback,
  getTrustedMemberApplications,
} from "./actions";
import {
  getModerationStats,
  getFlaggedContent,
  getContentReports,
  getContentReportsStats,
} from "./moderation/actions";
import { PageHeader } from "@/components/layout/PageHeader";
import { AdminLoadError, AdminPage } from "./components/AdminPage";
import { OverviewTab } from "./components/OverviewTab";
import { ProjectScheduleHealth } from "./components/ProjectScheduleHealth";
import { getProjectScheduleHealth } from "./server/project-schedule-health";

export const metadata = {
  title: "Admin overview",
  description:
    "Unified admin dashboard for managing feedback, trusted members, and content moderation",
};

export default async function AdminOverviewPage() {
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
    scheduleHealth,
  ] = await Promise.all([
    getAllFeedback(),
    getTrustedMemberApplications(),
    getModerationStats(),
    getFlaggedContent("pending"),
    getContentReports("pending"),
    getContentReportsStats(),
    getContentReports("under_review"),
    getProjectScheduleHealth(),
  ]);

  const stats = moderationStats.data;
  const aggregateReportStats = reportsStats.data ?? {
    total: 0,
    pending: 0,
    resolved: 0,
    highPriority: 0,
    recentWeek: 0,
  };

  const firstError =
    feedbackResult.error ||
    applicationsResult.error ||
    moderationStats.error ||
    flaggedContent.error ||
    pendingReports.error ||
    reportsStats.error ||
    underReviewReports.error;

  if (firstError) {
    return (
      <AdminPage>
        <PageHeader title="Admin overview" />
        <ProjectScheduleHealth result={scheduleHealth} />
        <AdminLoadError title="Error loading admin data" message={firstError} />
      </AdminPage>
    );
  }

  const flaggedContentData = flaggedContent.data || [];
  const pendingReportData = pendingReports.data || [];
  const underReviewReportData = underReviewReports.data || [];
  const reportPreview = [...pendingReportData, ...underReviewReportData].slice(
    0,
    4,
  );

  // Calculate stats for the overview
  const overviewStats = {
    feedbackCount: feedbackResult.data?.length || 0,
    trustedPendingCount:
      applicationsResult.data?.filter((a) => a.status === null).length || 0,
    flaggedPendingCount: stats?.pending || 0,
    reportsPendingCount: aggregateReportStats.pending || 0,
  };

  return (
    <>
      <OverviewTab
        stats={overviewStats}
        flaggedContent={flaggedContentData}
        reportPreview={reportPreview}
        reportsStats={aggregateReportStats}
      />
      <div className="mx-auto w-full max-w-6xl px-4 pb-8 sm:px-6">
        <ProjectScheduleHealth result={scheduleHealth} />
      </div>
    </>
  );
}
