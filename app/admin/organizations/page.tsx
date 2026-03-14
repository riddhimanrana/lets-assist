import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { checkSuperAdmin, getOrganizationsForAdmin } from "../actions";
import { OrganizationsTab } from "../components/OrganizationsTab";

export const metadata = {
  title: "Organizations | Admin",
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
      <div className="container mx-auto max-w-7xl py-8 px-4 md:px-6">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-destructive">
          Error loading organizations: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl space-y-8 py-8 px-4 md:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Organizations</h1>
        <p className="text-muted-foreground">
          Verify organizations and manage trust visibility badges across the platform.
        </p>
      </div>

      <Card className="border-border bg-card text-card-foreground shadow-xs">
        <CardHeader>
          <CardTitle>Organization Verification</CardTitle>
          <CardDescription>
            Toggle the verified badge for each organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OrganizationsTab organizations={organizations || []} />
        </CardContent>
      </Card>
    </div>
  );
}
