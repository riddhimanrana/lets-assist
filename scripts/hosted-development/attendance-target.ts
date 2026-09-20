const DEVELOPMENT_ORIGIN = "https://dev.lets-assist.com";
const PRODUCTION_PROJECT_REF = "fotdmeakexgrkronxlof";

type Environment = Record<string, string | undefined>;

function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value || /[\r\n]/u.test(value))
    throw new Error(`Hosted attendance requires a valid ${name}.`);
  return value;
}

function assertKey(key: string, role: "anon" | "service_role", ref: string) {
  if (key.startsWith(role === "anon" ? "sb_publishable_" : "sb_secret_")) {
    if (key.length >= 24 && /^[A-Za-z0-9_-]+$/u.test(key)) return;
  } else {
    try {
      const parts = key.split(".");
      const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      if (parts.length === 3 && claims.role === role && claims.ref === ref)
        return;
    } catch {
      // Reject malformed credentials without including their contents.
    }
  }
  throw new Error(`Hosted attendance requires the Development ${role} key.`);
}

export function readHostedAttendanceTarget(env: Environment = process.env) {
  if (env.ATTENDANCE_HOSTED_DEVELOPMENT !== "1")
    throw new Error("Hosted attendance requires explicit hosted mode.");
  const ref = required(env, "EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF");
  if (!/^[a-z0-9]{20}$/u.test(ref) || ref === PRODUCTION_PROJECT_REF)
    throw new Error(
      "Hosted attendance refuses a Production or invalid project ref.",
    );
  if (
    required(env, "ATTENDANCE_HOSTED_CONFIRMATION") !==
    `attendance-hosted-development:${ref}`
  )
    throw new Error(
      "Hosted attendance confirmation does not match the target.",
    );
  const appUrl = required(env, "ATTENDANCE_APP_URL");
  if (![DEVELOPMENT_ORIGIN, `${DEVELOPMENT_ORIGIN}/`].includes(appUrl))
    throw new Error(
      "Hosted attendance requires exactly https://dev.lets-assist.com/.",
    );
  const url = required(env, "SUPABASE_URL");
  if (
    ![`https://${ref}.supabase.co`, `https://${ref}.supabase.co/`].includes(url)
  )
    throw new Error(
      "Hosted attendance database must match the Development ref.",
    );
  const serviceRoleKey = required(env, "SUPABASE_SERVICE_ROLE_KEY");
  const publishableKey = required(env, "SUPABASE_PUBLISHABLE_KEY");
  assertKey(serviceRoleKey, "service_role", ref);
  assertKey(publishableKey, "anon", ref);
  return {
    hosted: true as const,
    appUrl: DEVELOPMENT_ORIGIN,
    url: new URL(url).origin,
    serviceRoleKey,
    publishableKey,
    protectionBypass: required(env, "VERCEL_AUTOMATION_BYPASS_SECRET"),
  };
}
