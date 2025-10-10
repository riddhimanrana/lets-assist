import { redirect } from "next/navigation";
import { checkSuperAdmin, getAllFeedback, getTrustedMemberApplications } from "./actions";
import { AdminClient } from "./AdminClient";

export const metadata = {
  title: "Admin Dashboard | Let's Assist",
  description: "Admin dashboard for managing feedback and trusted member applications",
};

export default async function AdminPage() {
  // Check if user is super admin
  const { isAdmin } = await checkSuperAdmin();
  
  if (!isAdmin) {
    redirect("/not-found");
  }

  // Fetch data
  const [feedbackResult, applicationsResult] = await Promise.all([
    getAllFeedback(),
    getTrustedMemberApplications(),
  ]);

  const feedback = feedbackResult.data || [];
  const applications = applicationsResult.data || [];

  return <AdminClient feedback={feedback} applications={applications} />;
}
