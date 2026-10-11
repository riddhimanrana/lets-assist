export type OrganizationDirectoryEmptyActions = {
  /** Visitors get one link to sign in; joining and creating both need an account. */
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
      signIn: true,
      join: false,
      create: false,
      description:
        "Sign in to join an organization with a code or to create one.",
    };
  }

  if (canCreate) {
    return {
      signIn: false,
      join: true,
      create: true,
      description:
        "Join one with a code from its admin, or create the first one.",
    };
  }

  return {
    signIn: false,
    join: true,
    create: false,
    description:
      "Join one with a code from its admin. Creating an organization needs Trusted Member access.",
  };
}
