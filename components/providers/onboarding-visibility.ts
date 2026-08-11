export const CSF_CONNECT_SIGNUP_FLOW = "csf_connect";
export const CSF_CONNECT_ROUTE_FRAGMENT = "/plugins/dvhs-csf/connect";

/**
 * A user who signed up through a CSF cohort onboarding link finishes account
 * setup on the connect route instead of /home. The context is only active
 * once the student's CSF record is connected (`?connected=1`), so the claim
 * flow itself is never interrupted by the username modal.
 */
export function isCsfConnectOnboardingContext({
  pathname,
  connectedParam,
  signupFlow,
}: {
  pathname: string | null | undefined;
  connectedParam: string | null | undefined;
  signupFlow: unknown;
}): boolean {
  return (
    signupFlow === CSF_CONNECT_SIGNUP_FLOW &&
    typeof pathname === "string" &&
    pathname.includes(CSF_CONNECT_ROUTE_FRAGMENT) &&
    connectedParam === "1"
  );
}

/**
 * Pure predicate for the InitialOnboardingModal eligibility. With
 * `isCsfConnectContext` false this is exactly the historical /home-only
 * behavior; the CSF connect context only ever widens the allowed routes.
 */
export function shouldShowOnboardingModal({
  onboardingCompleted,
  suppressOnboardingModal,
  suppressOnboardingAfterReturn,
  isHomeRoute,
  isCsfConnectContext,
}: {
  onboardingCompleted: boolean;
  suppressOnboardingModal: boolean;
  suppressOnboardingAfterReturn: boolean;
  isHomeRoute: boolean;
  isCsfConnectContext: boolean;
}): boolean {
  return (
    !onboardingCompleted &&
    !suppressOnboardingModal &&
    (isHomeRoute || isCsfConnectContext) &&
    !suppressOnboardingAfterReturn
  );
}
