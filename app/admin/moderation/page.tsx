import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { checkSuperAdmin } from "../actions";
import { AdminLoadError, AdminPage } from "../components/AdminPage";
import ModerationDashboard from "./ModerationDashboardWrapper";
import {
  getModerationStats,
  getFlaggedContent,
  getContentReports,
  getContentReportsStats,
} from "./actions";

export const metadata = {
  title: "Content Moderation | Admin",
  description: "Platform-wide content moderation dashboard",
};

export default async function AdminModerationPage() {
  // Check admin access
  const { isAdmin } = await checkSuperAdmin();

  if (!isAdmin) {
    redirect("/not-found");
  }

  // Fetch initial data
  const [stats, flaggedContent, contentReports, reportsStats] =
    await Promise.all([
      getModerationStats(),
      getFlaggedContent("pending"),
      getContentReports("pending"),
      getContentReportsStats(),
    ]);

  if (
    stats.error ||
    flaggedContent.error ||
    contentReports.error ||
    reportsStats.error
  ) {
    return (
      <AdminPage>
        <PageHeader title="Content moderation" />
        <AdminLoadError
          title="Error loading moderation data"
          message={
            stats.error ||
            flaggedContent.error ||
            contentReports.error ||
            reportsStats.error
          }
        />
      </AdminPage>
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
