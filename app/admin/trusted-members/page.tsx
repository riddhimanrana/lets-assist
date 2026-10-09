import { redirect } from "next/navigation";
import { checkSuperAdmin, getTrustedMemberApplications } from "../actions";
import { TrustedMembersTab } from "../components/TrustedMembersTab";
import { PageHeader } from "@/components/layout/PageHeader";
import { AdminLoadError, AdminPage } from "../components/AdminPage";

export const metadata = {
  title: "Admin trusted members",
  description: "Manage trusted member applications",
};

export default async function TrustedMembersPage() {
  const { isAdmin } = await checkSuperAdmin();

  if (!isAdmin) {
    redirect("/not-found");
  }

  const { data: applications, error } = await getTrustedMemberApplications();

  if (error) {
    return (
      <AdminPage>
        <PageHeader title="Trusted members" />
        <AdminLoadError title="Error loading applications" message={error} />
      </AdminPage>
    );
  }

  return (
    <AdminPage>
      <TrustedMembersTab trustedMembers={applications || []} />
    </AdminPage>
  );
}
