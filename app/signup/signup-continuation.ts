/**
 * What the signup page promises the person will get back to.
 *
 * The subtitle said "Sign up to continue with your project signup" for *any*
 * redirect, so a student arriving from a CSF class invitation was told they
 * were in the middle of signing up for a project they had never seen. The
 * copy has to follow the destination or say nothing specific at all.
 *
 * Deliberately shape-based rather than a list of known features: the platform
 * signup page should not have to learn about every plugin that can send
 * someone here.
 */
export function signupContinuationDescription(
  redirectPath?: string | null,
): string {
  const path = (redirectPath ?? "").trim();
  if (!path) return "Enter your details below to create your account";
  return path.startsWith("/projects/")
    ? "Sign up to continue with your project signup"
    : "Sign up to continue where you left off";
}
