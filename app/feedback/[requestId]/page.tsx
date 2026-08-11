import { Metadata } from "next";

import { verifyProjectFeedbackToken } from "@/services/project-feedback-token";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { FeedbackTokenClient } from "./FeedbackTokenClient";

export const metadata: Metadata = {
  title: "Share your feedback",
  robots: { index: false },
};

function InvalidLink() {
  return (
    <div className="container mx-auto flex min-h-[60vh] max-w-md items-center px-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>This link isn&apos;t valid anymore</CardTitle>
          <CardDescription>
            Feedback links expire after 30 days. If you have a Let&apos;s Assist
            account, you can still rate the project from its page.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

/**
 * Email-link landing page. Works logged out: the HMAC token is the whole
 * authorization. ?rating= is only ever a pre-selection — nothing is written
 * from a GET, because link prefetchers and mail scanners follow GETs.
 */
export default async function FeedbackTokenPage({
  params,
  searchParams,
}: {
  params: Promise<{ requestId: string }>;
  searchParams: Promise<{ token?: string; rating?: string }>;
}) {
  const { requestId } = await params;
  const { token, rating } = await searchParams;

  const payload = verifyProjectFeedbackToken(token);
  if (!payload || payload.requestId !== requestId) {
    return <InvalidLink />;
  }

  const admin = getAdminClient();
  const { data: request } = await admin
    .from("project_feedback_requests")
    .select("id, project_id, user_id, anonymous_id")
    .eq("id", requestId)
    .maybeSingle();
  if (!request || request.project_id !== payload.projectId) {
    return <InvalidLink />;
  }

  const { data: project } = await admin
    .from("projects")
    .select("id, title")
    .eq("id", request.project_id)
    .maybeSingle();
  if (!project) return <InvalidLink />;

  // Pre-fill an existing rating so the link doubles as an edit link.
  const identityColumn = request.user_id ? "user_id" : "anonymous_id";
  const identityValue = request.user_id ?? request.anonymous_id;
  const { data: existing } = identityValue
    ? await admin
        .from("project_feedback")
        .select("rating, comment")
        .eq("project_id", request.project_id)
        .eq(identityColumn, identityValue)
        .maybeSingle()
    : { data: null };

  const preselected = Number.parseInt(rating ?? "", 10);

  return (
    <div className="container mx-auto flex min-h-[60vh] max-w-md items-center px-4 py-10">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>How did volunteering go?</CardTitle>
          <CardDescription>{project.title}</CardDescription>
        </CardHeader>
        <CardContent>
          <FeedbackTokenClient
            requestId={requestId}
            token={token!}
            initial={existing ?? null}
            initialRating={
              Number.isInteger(preselected) &&
              preselected >= 1 &&
              preselected <= 5
                ? preselected
                : null
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
