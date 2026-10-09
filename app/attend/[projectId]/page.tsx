import { safeConsole } from "@/lib/safe-console";
import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProject } from "@/app/projects/[id]/actions";
import { headers } from "next/headers";
import AttendanceClient from "./AttendanceClient";
import { NoticePage } from "@/components/projects/NoticePage";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { CircleAlert, QrCode } from "lucide-react";
import { cookies } from "next/headers";
import {
  getAttendancePresenceCookieName,
  verifyAttendancePresence,
} from "@/lib/attendance/challenge";

// Validate scan context (no cookies)
function validateScanContext(userAgent: string) {
  const isMobileDevice = /Mobile|Android|iPhone|iPad|iPod/i.test(userAgent);
  return {
    valid: true,
    isMobileDevice,
    scanId: Math.random().toString(36).substring(2, 15),
    timestamp: new Date().toISOString(),
  };
}

/** A check-in dead end: what went wrong, what to do, and one way out. */
function AttendNotice({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md items-center px-4 py-12 sm:px-6">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">{icon}</EmptyMedia>
          <EmptyTitle>
            <h1>{title}</h1>
          </EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        {action ? (
          <EmptyContent>
            <Link
              href={action.href}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              {action.label}
            </Link>
          </EmptyContent>
        ) : null}
      </Empty>
    </div>
  );
}

type Props = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ session?: string; schedule?: string }>;
};

async function AttendanceContent({
  projectId,
  sessionUuid,
  scheduleId,
}: {
  projectId: string;
  sessionUuid?: string;
  scheduleId?: string;
}) {
  safeConsole.log(
    "Application diagnostic from app/attend/[projectId]/page",
    `AttendPage: projectId=${projectId}, sessionUuid=${sessionUuid}, scheduleId=${scheduleId}`,
  );

  // require session and event
  if (!projectId || !sessionUuid || !scheduleId) {
    return (
      <AttendNotice
        icon={<CircleAlert aria-hidden="true" />}
        title="This check-in link is not valid"
        description="Scan the QR code at the event again, or ask the organizer for a new one."
        action={
          projectId
            ? { href: `/projects/${projectId}`, label: "Back to project" }
            : { href: "/", label: "Go to home" }
        }
      />
    );
  }

  // fetch project and validate session
  const { project, error } = await getProject(projectId);
  if (error || !project || project.session_id !== sessionUuid) {
    return (
      <AttendNotice
        icon={<CircleAlert aria-hidden="true" />}
        title="Project not found"
        description="This QR code does not match a project. The project may have been deleted, or the code may be out of date."
        action={{ href: "/", label: "Go to home" }}
      />
    );
  }

  // scan context
  const headersInstance = await headers();
  const ua = headersInstance.get("user-agent") || "";
  const scanValidation = validateScanContext(ua);

  // verify QR scan cookie
  const cookieStore = await cookies();
  const cookieName = getAttendancePresenceCookieName(projectId);
  const tokenCookie = cookieStore.get(cookieName);
  const presence = verifyAttendancePresence(tokenCookie?.value, {
    projectId,
    sessionId: sessionUuid,
    scheduleId,
  });
  if (!presence.ok) {
    safeConsole.log("AttendPage: cookie verification failed");
    return (
      <AttendNotice
        icon={<QrCode aria-hidden="true" />}
        title="Scan the QR code again"
        description="If you just logged in or signed up, scan the event's QR code with your camera again to check in. This confirms you are at the right session."
      />
    );
  }

  // auth check
  const supabase = await createClient();
  // Get authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch user's full_name from public profiles table if user exists
  let userProfile = null;
  if (user?.id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle();
    if (profile) {
      userProfile = profile;
    }
  }

  // existing check‑in?
  let existingCheckIn = null;
  const { data } = (await supabase
    .from("project_signups")
    .select("id, check_in_time, check_out_time, schedule_id")
    .eq("project_id", projectId)
    .eq("schedule_id", scheduleId)
    .eq("user_id", user?.id)
    .maybeSingle()) as {
    data: {
      id: string;
      check_in_time: string | null;
      check_out_time: string | null;
      schedule_id: string | null;
    } | null;
  };
  existingCheckIn = data;

  return (
    <AttendanceClient
      project={project}
      scheduleId={scheduleId}
      user={
        user
          ? {
              ...user,
              user_metadata: {
                ...(user.user_metadata ?? {}),
                full_name:
                  userProfile?.full_name ??
                  (user.user_metadata as { full_name?: string | null } | null)
                    ?.full_name ??
                  null,
              },
            }
          : null
      }
      existingCheckIn={existingCheckIn}
      scanInfo={scanValidation}
      projectAllowsAnonymous={!project.require_login}
    />
  );
}

export default async function AttendPage(
  props: Props,
): Promise<React.ReactElement> {
  const { projectId } = await await props.params;
  const { session: sessionUuid, schedule: scheduleId } =
    await props.searchParams;

  return (
    <Suspense
      fallback={
        <NoticePage icon={<Spinner />} title="Loading attendance page..." />
      }
    >
      <AttendanceContent
        projectId={projectId}
        sessionUuid={sessionUuid}
        scheduleId={scheduleId}
      />
    </Suspense>
  );
}
