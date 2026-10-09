import { createServerClient } from "@supabase/ssr";
import type { BrowserContext } from "@playwright/test";
import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";
import { readHostedAttendanceTarget } from "../../../scripts/hosted-development/attendance-target";
import { requestVercelBypassCookie } from "../../../scripts/hosted-development/vercel-bypass-cookie.mjs";

export function getAttendanceEnvironment() {
  if (process.env.ATTENDANCE_HOSTED_DEVELOPMENT !== undefined)
    return readHostedAttendanceTarget();
  return { ...getCsfIsolatedSupabaseEnv(), hosted: false as const };
}

type HostedTarget = ReturnType<typeof readHostedAttendanceTarget>;

export async function prepareHostedContext(
  context: BrowserContext,
  target: Pick<HostedTarget, "appUrl" | "protectionBypass">,
  requestCookie = requestVercelBypassCookie,
) {
  const bypass = await requestCookie({
    appUrl: new URL(target.appUrl),
    path: "/login",
    protectionBypass: target.protectionBypass,
  });
  await context.addCookies([{ ...bypass, sameSite: "Lax" }]);
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (
      request.isNavigationRequest() &&
      request.resourceType() === "document" &&
      new URL(request.url()).origin !== target.appUrl
    ) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
}

// Use the same server-side SSR cookie flow as hosted CSF acceptance.
export async function signInHostedFixture(
  context: BrowserContext,
  target: Pick<HostedTarget, "url" | "appUrl" | "publishableKey">,
  account: { email: string; password: string; userId: string },
  createAuth = createServerClient,
) {
  if (
    !/^attendance\.(coordinator|walkin)\.[a-f0-9]{8}@local\.test$/u.test(
      account.email,
    )
  )
    throw new Error(
      "Hosted attendance authentication accepts only its fictional accounts.",
    );
  const cookieStore = new Map<string, string>();
  const auth = createAuth(target.url, target.publishableKey, {
    cookies: {
      getAll: () => [...cookieStore].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          if (value) cookieStore.set(name, value);
          else cookieStore.delete(name);
        }
      },
    },
  });
  const { data, error } = await auth.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  });
  if (
    error ||
    data.user?.id !== account.userId ||
    !data.session ||
    !cookieStore.size
  )
    throw new Error("Hosted attendance fixture authentication failed.");
  await context.addCookies(
    [...cookieStore].map(([name, value]) => ({
      name,
      value,
      url: target.appUrl,
      secure: true,
      sameSite: "Lax" as const,
    })),
  );
}

export async function cleanupAttendanceFixture(
  admin: import("@supabase/supabase-js").SupabaseClient,
  projectId: string,
  userIds: Array<string | null>,
) {
  const failures: string[] = [];
  // Certificates intentionally survive project deletion in normal product use.
  const certificates = await admin
    .from("certificates")
    .delete()
    .eq("project_id", projectId);
  if (certificates.error) return ["fixture_certificates_cleanup_failed"];
  const project = await admin.from("projects").delete().eq("id", projectId);
  if (project.error) return ["fixture_project_cleanup_failed"];
  for (const table of [
    "project_signups",
    "certificates",
    "anonymous_signups",
    "project_paper_scan_batches",
    "project_paper_scan_rows",
    "project_attendance_intervals",
    "project_attendance_print_sheets",
    "project_attendance_print_rows",
    "project_paper_roster_entries",
    "hours_publication_receipts",
    "paper_signup_notification_outbox",
  ]) {
    const remaining = await admin
      .from(table)
      .select("project_id", { count: "exact", head: true })
      .eq("project_id", projectId);
    if (remaining.error || remaining.count !== 0)
      failures.push("fixture_rows_cleanup_failed");
  }
  const remainingProject = await admin
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("id", projectId);
  if (remainingProject.error || remainingProject.count !== 0)
    failures.push("fixture_project_remains");
  for (const id of userIds) {
    if (!id) continue;
    const result = await admin.auth.admin.deleteUser(id);
    if (result.error) failures.push("fixture_auth_cleanup_failed");
    const profile = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("id", id);
    if (profile.error || profile.count !== 0)
      failures.push("fixture_profile_remains");
  }
  return failures;
}
