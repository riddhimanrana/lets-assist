import { normalizeRedirectPath } from "@/app/signup/redirect-utils";

export function passwordRecoveryPath(
  pathname: "/login" | "/reset-password",
  redirectPath?: string | null,
): string {
  const continuation = normalizeRedirectPath(redirectPath);
  return continuation
    ? `${pathname}?${new URLSearchParams({ redirect: continuation })}`
    : pathname;
}
