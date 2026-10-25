import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/PageHeader";

import { checkSuperAdmin } from "../actions";
import { AdminPage } from "../components/AdminPage";
import UserAccessClient from "./UserAccessClient";

export const metadata = {
  title: "Admin user access",
  description: "Restrict, ban, or restore user access to the platform",
};

export default async function UserAccessControlPage() {
  const { isAdmin } = await checkSuperAdmin();

  if (!isAdmin) {
    redirect("/not-found");
  }

  return (
    <AdminPage width="form">
      <PageHeader
        title="User access control"
        description="Restrict or ban user accounts and automatically notify affected users."
      />
      <UserAccessClient />
    </AdminPage>
  );
}
