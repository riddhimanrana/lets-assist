export const CSF_APPLICATION_RUNTIME_FLAG =
  "dvhs-csf-application-runtime" as const;

export const CSF_APPLICATION_RUNTIME_DATABASE_FLAG =
  "application-runtime" as const;

export type PluginApplicationRouteTarget = {
  deploymentId: string;
  deploymentUrl: string;
  runtimeVersion: string;
};

const CSF_APPLICATION_PATH =
  /^\/organization\/([^/]+)\/plugins\/dvhs-csf\/access-proof\/?$/u;

export function getCsfApplicationOrganizationId(
  pathname: string,
): string | null {
  return CSF_APPLICATION_PATH.exec(pathname)?.[1] ?? null;
}

export function isCsfApplicationPath(pathname: string): boolean {
  return getCsfApplicationOrganizationId(pathname) !== null;
}

export function shouldRouteCsfApplication(input: {
  pathname: string;
  routeTargetAvailable: boolean;
}): boolean {
  return input.routeTargetAvailable && isCsfApplicationPath(input.pathname);
}

export function parsePluginApplicationRouteTarget(
  value: unknown,
): PluginApplicationRouteTarget | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Record<string, unknown>;
  if (
    candidate.routable !== true ||
    typeof candidate.deploymentId !== "string" ||
    candidate.deploymentId.length === 0 ||
    typeof candidate.deploymentUrl !== "string" ||
    typeof candidate.runtimeVersion !== "string" ||
    candidate.runtimeVersion.length === 0
  ) {
    return null;
  }

  try {
    const deploymentUrl = new URL(candidate.deploymentUrl);
    if (
      deploymentUrl.protocol !== "https:" ||
      !deploymentUrl.hostname.endsWith(".vercel.app") ||
      deploymentUrl.username ||
      deploymentUrl.password ||
      deploymentUrl.port ||
      deploymentUrl.pathname !== "/" ||
      deploymentUrl.search ||
      deploymentUrl.hash
    ) {
      return null;
    }
    return {
      deploymentId: candidate.deploymentId,
      deploymentUrl: deploymentUrl.origin,
      runtimeVersion: candidate.runtimeVersion,
    };
  } catch {
    return null;
  }
}
