export const CSF_APPLICATION_RUNTIME_FLAG =
  "dvhs-csf-application-runtime" as const;

export const CSF_APPLICATION_RUNTIME_DATABASE_FLAG =
  "application-runtime" as const;

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
  featureFlagEnabled: boolean;
}): boolean {
  return input.featureFlagEnabled && isCsfApplicationPath(input.pathname);
}
