export const CSF_APPLICATION_RUNTIME_FLAG =
  "dvhs-csf-application-runtime" as const;

const CSF_APPLICATION_PATH =
  /^\/organization\/([^/]+)\/plugins\/dvhs-csf\/access-proof\/?$/u;

export function shouldRouteCsfApplication(input: {
  pathname: string;
  enabled: string | undefined;
  organizationIds: string | undefined;
}): boolean {
  if (input.enabled?.trim().toLowerCase() !== "true") return false;
  const organizationId = CSF_APPLICATION_PATH.exec(input.pathname)?.[1];
  if (!organizationId) return false;

  const allowed = new Set(
    (input.organizationIds ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return allowed.has(organizationId);
}
