import { redirect } from "next/navigation";
import { checkSuperAdmin, getAllFeedback } from "../actions";
import { FeedbackTab } from "../components/FeedbackTab";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const metadata = {
  title: "Feedback | Admin",
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
      <div className="p-6 text-destructive">
        Error loading feedback: {error}
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl space-y-8 py-8 px-4 md:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">User Feedback</h1>
        <p className="text-muted-foreground">
          Review user feedback, ideas, and issues submitted through the platform.
        </p>
      </div>
      <Card className="border-border bg-card text-card-foreground shadow-sm">
        <CardHeader>
          <CardTitle>Feedback & Moderation</CardTitle>
          <CardDescription>Sort, filter, and moderate incoming submissions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <FeedbackTab feedback={feedback || []} />
        </CardContent>
      </Card>
    </div>
  );
}
