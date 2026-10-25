import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { checkSuperAdmin, getOrganizationsForAdmin } from "../actions";
import { AdminLoadError, AdminPage } from "../components/AdminPage";
import { OrganizationsTab } from "../components/OrganizationsTab";

export const metadata = {
  title: "Admin organizations",
  description: "Manage organization verification status",
};

export default async function AdminOrganizationsPage() {
  const { isAdmin } = await checkSuperAdmin();

  if (!isAdmin) {
    redirect("/not-found");
  }

  const { data: organizations, error } = await getOrganizationsForAdmin();

  if (error) {
    return (
      <AdminPage>
        <PageHeader title="Organizations" />
        <AdminLoadError title="Error loading organizations" message={error} />
      </AdminPage>
    );
  }

  return (
    <AdminPage>
      <PageHeader
        title="Organizations"
        description="Verify organizations and manage trust visibility badges across the platform."
      />
      <OrganizationsTab organizations={organizations || []} />
    </AdminPage>
  );
}
