import { redirect } from "next/navigation";

import { checkSuperAdmin } from "@/app/admin/actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import PluginControlPlane from "./PluginControlPlane";
import { getPluginControlPlaneData } from "./actions";

export const metadata = {
  title: "Plugin Control Plane | Let's Assist Admin",
  description:
    "Manage plugin catalog controls, organization entitlements, and force-update operations.",
};

export default async function AdminPluginsPage() {
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    redirect("/not-found");
  }

  const data = await getPluginControlPlaneData();

  if (data.error) {
    return (
      <div className="container mx-auto max-w-7xl px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Plugin Control Plane</CardTitle>
            <CardDescription>Unable to load plugin control data.</CardDescription>
          </CardHeader>
          <CardContent className="text-destructive text-sm">{data.error}</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl space-y-6 px-4 py-8 md:px-6">

      {data.warning ? (
        <Card className="border-amber-200/70 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20">
          <CardHeader>
            <CardTitle>Migration notice</CardTitle>
            <CardDescription>{data.warning}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <PluginControlPlane data={data} />
    </div>
  );
}