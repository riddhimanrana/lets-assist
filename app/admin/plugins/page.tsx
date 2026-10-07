import { redirect } from "next/navigation";

import { checkSuperAdmin } from "@/app/admin/actions";
import { AdminLoadError, AdminPage } from "@/app/admin/components/AdminPage";
import { PageHeader } from "@/components/layout/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import PluginControlPlane from "./PluginControlPlane";
import { getPluginControlPlaneData } from "./actions";

export const metadata = {
  title: "Plugins | Let's Assist Admin",
  description: "Install, update, and monitor organization plugins.",
};

export default async function AdminPluginsPage() {
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    redirect("/not-found");
  }

  const data = await getPluginControlPlaneData();

  if (data.error) {
    return (
      <AdminPage>
        <PageHeader title="Plugins" />
        <AdminLoadError
          title="Unable to load plugin control data."
          message={data.error}
        />
      </AdminPage>
    );
  }

  return (
    <AdminPage>
      {data.warning ? (
        <Alert variant="warning">
          <AlertTitle>Migration notice</AlertTitle>
          <AlertDescription>{data.warning}</AlertDescription>
        </Alert>
      ) : null}

      <PluginControlPlane data={data} />
    </AdminPage>
  );
}
