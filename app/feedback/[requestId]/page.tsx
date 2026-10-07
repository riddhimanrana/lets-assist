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

import { NoticePage } from "@/components/projects/NoticePage";
import { buttonVariants } from "@/components/ui/button-variants";
import { CircleAlert } from "lucide-react";
import Link from "next/link";

import { FeedbackTokenClient } from "./FeedbackTokenClient";
import { ExperienceFeedbackForm } from "@/components/feedback/ExperienceFeedbackForm";
import { saveExperienceFeedbackWithToken } from "./actions";

export const metadata: Metadata = {
  title: "Share your feedback",
  robots: { index: false },
};

function InvalidLink() {
  return (
    <NoticePage
      icon={<CircleAlert aria-hidden="true" />}
      title="This link isn't valid anymore"
      description="Feedback links expire after 30 days."
      actions={
        <Link href="/projects" className={buttonVariants()}>
          Browse projects
        </Link>
      }
    />
  );
}

/**
 * Email-link landing page. Works logged out: the HMAC token is the whole
 * authorization. ?rating= only preselects legacy organizer ratings. Nothing is written
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
    .select("id, project_id, user_id, anonymous_id, purpose")
    .eq("id", requestId)
    .maybeSingle();
  if (
    !request ||
    request.project_id !== payload.projectId ||
    (payload.subject.kind === "user"
      ? request.user_id !== payload.subject.userId
      : request.anonymous_id !== payload.subject.anonymousSignupId)
  ) {
    return <InvalidLink />;
  }

  const { data: project } = await admin
    .from("projects")
    .select("id, title")
    .eq("id", request.project_id)
    .maybeSingle();
  if (!project) return <InvalidLink />;

  if (request.purpose === "platform_experience") {
    const { data: feedback } = await admin
      .from("feedback")
      .select("rating, feedback")
      .eq("purpose", "platform_experience")
      .eq("project_request_id", requestId)
      .maybeSingle();
    return (
      <main className="mx-auto flex min-h-[70vh] w-full max-w-md items-center px-4 py-12 sm:px-6">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>How was using Let&apos;s Assist?</CardTitle>
            <CardDescription>
              Thanks for volunteering at {project.title}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ExperienceFeedbackForm
              initial={
                feedback?.rating
                  ? { rating: feedback.rating, comment: feedback.feedback }
                  : null
              }
              save={saveExperienceFeedbackWithToken.bind(
                null,
                requestId,
                token!,
              )}
            />
          </CardContent>
        </Card>
      </main>
    );
  }

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
    <main className="mx-auto flex min-h-[70vh] w-full max-w-md items-center px-4 py-12 sm:px-6">
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
    </main>
  );
}
