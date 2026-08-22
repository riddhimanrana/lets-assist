export type PluginApplicationEnvironment = "development" | "production";

const LOCAL_PLUGIN_APPLICATION_URL = "http://127.0.0.1:3001";

export function resolvePluginApplicationEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PluginApplicationEnvironment | null {
  if (environment.VERCEL_ENV === "production") {
    return "production";
  }
  if (environment.VERCEL_GIT_COMMIT_REF === "development") {
    return "development";
  }
  return null;
}

export function resolveLocalPluginApplicationUrl(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  if (environment.VERCEL || environment.VERCEL_ENV) return null;
  if (environment.CSF_LOCAL_FIXTURE_MODE !== "1") return null;
  if (environment.PLUGIN_APPLICATION_LOCAL_URL !== LOCAL_PLUGIN_APPLICATION_URL)
    return null;
  return LOCAL_PLUGIN_APPLICATION_URL;
}

export function resolvePluginApplicationDeploymentBypassSecret(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const secret = environment.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  return secret || undefined;
}
