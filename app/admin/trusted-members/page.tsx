import { redirect } from "next/navigation";
import { checkSuperAdmin, getTrustedMemberApplications } from "../actions";
import { TrustedMembersTab } from "../components/TrustedMembersTab";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const metadata = {
  title: "Trusted Members | Admin",
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
      <div className="container mx-auto max-w-7xl py-8 px-4">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-destructive">
          Error loading applications: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl space-y-8 py-8 px-4 md:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Trusted Members</h1>
        <p className="text-muted-foreground">
          Review applications and manage trusted member status for users.
        </p>
      </div>
      
      <Card className="border-border bg-card text-card-foreground shadow-sm">
        <CardHeader>
          <CardTitle>Applications & Members</CardTitle>
          <CardDescription>
            Manage who has trusted member access to the platform.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TrustedMembersTab trustedMembers={applications || []} />
        </CardContent>
      </Card>
    </div>
  );
}
