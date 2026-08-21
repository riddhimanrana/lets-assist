export type PluginApplicationEnvironment = "development" | "production";

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
