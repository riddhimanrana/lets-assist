import { redirect } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { checkSuperAdmin } from "../actions";
import UserAccessClient from "./UserAccessClient";

export const metadata = {
  title: "User Access Control | Admin",
  description: "Restrict, ban, or restore user access to the platform",
};

export default async function UserAccessControlPage() {
  const { isAdmin } = await checkSuperAdmin();

  if (!isAdmin) {
    redirect("/not-found");
  }

  return (
    <div className="container mx-auto max-w-7xl space-y-8 px-4 py-8 md:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">User Access Control</h1>
        <p className="text-muted-foreground">
          Restrict or ban user accounts and automatically notify affected users.
        </p>
      </div>

      <Card className="border-border bg-card text-card-foreground shadow-xs">
        <CardHeader>
          <CardTitle>Account moderation</CardTitle>
        </CardHeader>
        <CardContent>
          <UserAccessClient />
        </CardContent>
      </Card>
    </div>
  );
}
