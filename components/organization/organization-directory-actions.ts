export type OrganizationDirectoryEmptyActions = {
  /** Visitors are asked to sign up first; joining and creating both need an account. */
  signUp: boolean;
  /** Visitors who already have an account keep a link to sign in. */
  signIn: boolean;
  join: boolean;
  create: boolean;
  description: string;
};

/**
 * Which actions the empty organization directory offers. This only maps the
 * two answers the page already has onto buttons. `canCreate` is the caller's
 * existing Trusted Member result and is never widened here: a visitor gets no
 * create action even if it is passed as true.
 */
export function getOrganizationDirectoryEmptyActions({
  isLoggedIn,
  canCreate,
}: {
  isLoggedIn: boolean;
  canCreate: boolean;
}): OrganizationDirectoryEmptyActions {
  if (!isLoggedIn) {
    return {
      signUp: true,
      signIn: true,
      join: false,
      create: false,
      description:
        "Sign up to join an organization with a code. Creating one also needs Trusted Member access.",
    };
  }

  if (canCreate) {
    return {
      signUp: false,
      signIn: false,
      join: true,
      create: true,
      description:
        "Join one with a code from its admin, or create the first one.",
    };
  }

  return {
    signUp: false,
    signIn: false,
    join: true,
    create: false,
    description:
      "Join one with a code from its admin. Creating an organization needs Trusted Member access.",
  };
}
