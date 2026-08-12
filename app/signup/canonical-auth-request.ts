import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  resolveAuthProducerNavigation,
  resolveAuthRequestOrigin,
  resolveConfiguredSiteOrigin,
} from "./request-origin";

/**
 * Run a PKCE-producing operation only after the browser host and callback
 * origin agree. On a stale hosted alias this emits an absolute trusted
 * navigation before the callback is entered, so no verifier cookie can be
 * written to the wrong host. Same-port loopback spellings remain distinct and
 * are deliberately preserved.
 */
export async function runOnCanonicalAuthOrigin<T>(
  destinationPath: string,
  producer: (authOrigin: string) => Promise<T>,
): Promise<T> {
  const requestHost = (await headers()).get("host");
  const authOrigin = resolveAuthRequestOrigin({
    configuredOrigin: resolveConfiguredSiteOrigin(),
    requestHost,
  });
  const canonicalNavigation = resolveAuthProducerNavigation({
    authOrigin,
    requestHost,
    destinationPath,
  });

  if (canonicalNavigation) redirect(canonicalNavigation);

  return producer(authOrigin);
}
