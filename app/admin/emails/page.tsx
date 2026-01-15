import { redirect } from "next/navigation";
import { checkSuperAdmin } from "../actions";
import { listReceivedEmails, listSentEmails } from "./actions";
import { EmailsDashboard } from "./EmailsDashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Emails | Admin",
  description: "Inbound and outbound support email center",
};

export default async function AdminEmailsPage() {
  const { isAdmin } = await checkSuperAdmin();

  if (!isAdmin) {
    redirect("/not-found");
  }

  const [receivedResult, sentResult] = await Promise.all([
    listReceivedEmails({ limit: 50 }),
    listSentEmails({ limit: 50 }),
  ]);

  if (receivedResult.error || sentResult.error) {
    return (
      <div className="container mx-auto max-w-7xl py-8 px-4">
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive">Unable to load email inbox</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {receivedResult.error || sentResult.error}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <EmailsDashboard
      initialReceived={receivedResult.data?.emails ?? []}
      initialSent={sentResult.data?.emails ?? []}
      receivedHasMore={receivedResult.data?.hasMore ?? false}
      sentHasMore={sentResult.data?.hasMore ?? false}
    />
  );
}
