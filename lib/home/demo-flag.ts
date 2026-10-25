type Environment = Record<string, string | undefined>;

export const HOME_DEMO_FLAG = "LETS_ASSIST_HOME_DEMO";

/**
 * Whether the fictional home demo may render. The flag alone is never enough:
 * the deployment must also identify itself as local development or a Vercel
 * preview. Production, and any environment that does not say what it is, gets
 * `false`.
 */
export function isHomeDemoEnabled(environment: Environment): boolean {
  if (environment[HOME_DEMO_FLAG] !== "1") return false;

  const vercelEnvironment = environment.VERCEL_ENV;
  if (vercelEnvironment === "production") return false;
  if (vercelEnvironment === "preview") return true;
  if (vercelEnvironment === undefined || vercelEnvironment === "development") {
    // A standalone `next start` reports NODE_ENV=production with no
    // VERCEL_ENV. That could be a real deployment, so it stays off.
    return environment.NODE_ENV === "development";
  }
  return false;
}
