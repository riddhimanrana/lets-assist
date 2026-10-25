import { redirect } from "next/navigation";
import { checkSuperAdmin, getAllFeedback } from "../actions";
import { FeedbackTab } from "../components/FeedbackTab";
import { PageHeader } from "@/components/layout/PageHeader";
import { AdminLoadError, AdminPage } from "../components/AdminPage";

export const metadata = {
  title: "Admin feedback",
  description: "User feedback and suggestions",
};

export default async function FeedbackPage() {
  const { isAdmin } = await checkSuperAdmin();

  if (!isAdmin) {
    redirect("/not-found");
  }

  const { data: feedback, error } = await getAllFeedback();

  if (error) {
    return (
      <AdminPage>
        <PageHeader title="User feedback" />
        <AdminLoadError title="Error loading feedback" message={error} />
      </AdminPage>
    );
  }

  return (
    <AdminPage>
      <PageHeader
        title="User feedback"
        description="High-speed moderation queue for user feedback, ideas, and issues."
      />
      <FeedbackTab feedback={feedback || []} />
    </AdminPage>
  );
}
