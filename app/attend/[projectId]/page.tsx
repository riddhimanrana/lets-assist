import { Suspense } from "react";
import { createClient } from "@/utils/supabase/server";
import { getProject } from "@/app/projects/[id]/actions";
import { headers } from "next/headers";
import AttendanceClient from "./AttendanceClient";
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from "@/components/ui/card";
import { CircleAlert, QrCode } from "lucide-react";
import { cookies } from "next/headers";

// Validate scan context (no cookies)
function validateScanContext(userAgent: string) {
  const isMobileDevice = /Mobile|Android|iPhone|iPad|iPod/i.test(userAgent);
  return {
    valid: true,
    isMobileDevice,
    scanId: Math.random().toString(36).substring(2,15),
    timestamp: new Date().toISOString()
  };
}

type Props = {
    params: Promise<{ projectId: string }>;
    searchParams: Promise<{ session?: string; schedule?: string }>;
};

export default async function AttendPage(props: Props): Promise<React.ReactElement> {
    const { projectId } = await (await props.params);
    const { session: sessionUuid, schedule: scheduleId } = await props.searchParams;
    console.log(`AttendPage: projectId=${projectId}, sessionUuid=${sessionUuid}, scheduleId=${scheduleId}`);

    // require session and event
    if (!projectId || !sessionUuid || !scheduleId) {
        return (
            <div className="flex items-center justify-center min-h-[calc(100vh-160px)] lg:min-h-[calc(100vh-64px)]">
                <Card className="mx-auto max-w-[375px] sm:max-w-md w-full shadow-lg">
                    <CardHeader className="space-y-1">
                        <div className="flex items-center justify-center mb-4">
                            <CircleAlert className="h-12 w-12 text-destructive" />
                        </div>
                        <CardTitle className="text-2xl text-center">Invalid Attendance Link</CardTitle>
                        <CardDescription className="text-center">
                            This attendance link is missing required parameters. Please scan the QR code provided by the project organizer.
                        </CardDescription>
                    </CardHeader>
                </Card>
            </div>
        );
    }

    // fetch project and validate session
    const { project, error } = await getProject(projectId);
    if (error || !project || project.session_id !== sessionUuid) {
        return (
            <div className="container mx-auto py-12 px-4 md:px-6">
                <div className="max-w-md mx-auto">
                    <h1 className="text-2xl font-bold mb-6">Project Not Found</h1>
                    <p className="text-muted-foreground mb-4">
                        The project associated with this QR code could not be found. It may have been deleted.
                    </p>
                </div>
            </div>
        );
    }

    // scan context
    const headersInstance = await headers();
    const ua = headersInstance.get("user-agent") || "";
    const scanValidation = validateScanContext(ua);

    // verify QR scan cookie
    const cookieStore = await cookies();
    const cookieName = `attend_${projectId}_${sessionUuid}_${scheduleId}`;
    const tokenCookie = cookieStore.get(cookieName);
    const hasToken = Boolean(tokenCookie);
    console.log(`AttendPage: verifying cookie ${cookieName}:`, hasToken, tokenCookie);
    if (!hasToken) {
        console.log("AttendPage: cookie verification failed");
        return (
            <div className="flex items-center justify-center min-h-[calc(100vh-160px)] lg:min-h-[calc(100vh-64px)]">
                <Card className="mx-auto max-w-[375px] sm:max-w-md w-full shadow-lg">
                    <CardHeader className="space-y-1">
                        <div className="flex items-center justify-center mb-4">
                            <QrCode className="h-12 w-12 text-chart-4" />
                        </div>
                        <CardTitle className="text-2xl text-center">Please Scan QR Code Again</CardTitle>
                        <CardDescription className="text-center mt-2">
                            If you just logged in or signed up, you&apos;ll need to scan the QR code again to continue with attendance. This is a security measure to ensure you&apos;re accessing the correct session.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col items-center">
                        <p className="text-muted-foreground text-center mb-4">Simply scan the QR code again using your device&apos;s camera to proceed with checking in.</p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // auth check
    const supabase = await createClient();
    // Get authenticated user
    const { data: { user } } = await supabase.auth.getUser();

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
    const { data } = await supabase
        .from("project_signups")
        .select("id, check_in_time, check_out_time, user_id, anonymous_id")
        .eq("project_id", projectId)
        .eq("schedule_id", scheduleId)
        .eq("user_id", user?.id)
        .maybeSingle();
    existingCheckIn = data;

    return (
        <Suspense fallback={<div className="container mx-auto py-12 px-4 text-center">Loading attendance page...</div>}>
            <AttendanceClient
              project={project}
              scheduleId={scheduleId}
              user={user ? { ...user, name: userProfile?.full_name } : null}
              existingCheckIn={existingCheckIn}
              scanInfo={scanValidation}
              projectAllowsAnonymous={!project.require_login}
            />
        </Suspense>
    );
}
