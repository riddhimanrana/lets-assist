type Environment = Record<string, string | undefined>;
export function telemetryRuntime(environment: Environment = process.env) {
  const stage =
    environment.VERCEL_ENV === "production"
      ? "production"
      : environment.VERCEL_ENV === "preview"
        ? "preview"
        : "local";
  const sha =
    environment.LETS_ASSIST_BUILD_SHA || environment.VERCEL_GIT_COMMIT_SHA;
  return {
    enabled: environment.NODE_ENV === "production" && stage === "production",
    attributes: {
      "service.name": "lets-assist",
      "service.version": sha && /^[a-f0-9]{40}$/.test(sha) ? sha : "unknown",
      "deployment.environment.name": stage,
    },
  };
}
