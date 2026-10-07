import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getProject } from "@/app/projects/[id]/actions";
import { headers } from "next/headers";
import AttendanceClient from "./AttendanceClient";
import { NoticePage } from "@/components/projects/NoticePage";
import { Spinner } from "@/components/ui/spinner";
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
  console.log(
    `AttendPage: projectId=${projectId}, sessionUuid=${sessionUuid}, scheduleId=${scheduleId}`,
  );

  // require session and event
  if (!projectId || !sessionUuid || !scheduleId) {
    return (
      <NoticePage
        icon={<CircleAlert aria-hidden="true" />}
        tone="destructive"
        title="Invalid attendance link"
        description="This attendance link is missing required parameters. Please scan the QR code provided by the project organizer."
      />
    );
  }

  // fetch project and validate session
  const { project, error } = await getProject(projectId);
  if (error || !project || project.session_id !== sessionUuid) {
    return (
      <NoticePage
        icon={<CircleAlert aria-hidden="true" />}
        title="Project not found"
        description="The project associated with this QR code could not be found. It may have been deleted."
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
    console.log("AttendPage: cookie verification failed");
    return (
      <NoticePage
        icon={<QrCode aria-hidden="true" />}
        tone="warning"
        title="Please scan QR code again"
        description="If you just logged in or signed up, you'll need to scan the QR code again to continue with attendance. This is a security measure to ensure you're accessing the correct session."
      >
        <p className="text-muted-foreground text-sm">
          Simply scan the QR code again using your device&apos;s camera to
          proceed with checking in.
        </p>
      </NoticePage>
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
