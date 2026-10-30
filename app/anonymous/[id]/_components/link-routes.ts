/** Sign in, then come back to this exact guest profile to finish linking. */
export function anonymousLinkLoginHref(id: string, accessToken: string) {
  return `/login?redirect=${encodeURIComponent(`/anonymous/${id}?token=${encodeURIComponent(accessToken)}&link=1`)}`;
}
