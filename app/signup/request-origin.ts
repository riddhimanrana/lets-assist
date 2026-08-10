/**
 * Origin selection for the auth emails that create a PKCE verifier.
 *
 * Supabase stores the PKCE code verifier in a cookie on the origin that issued
 * the sign-up, while the confirmation link is built from `emailRedirectTo`. On
 * a loopback development host the two can disagree -- signing up on
 * `http://127.0.0.1:3012` while `NEXT_PUBLIC_SITE_URL` is
 * `http://localhost:3012` writes the verifier for `127.0.0.1` and mails a
 * `localhost` link, so confirming fails with `pkce_code_verifier_not_found`.
 * `127.0.0.1` and `localhost` are different cookie origins even though they
 * are the same machine.
 *
 * The fix is deliberately narrow: the request's own `Host` may only be honored
 * when the configured origin is itself loopback and the request is the same
 * loopback service on the same port. Everything else -- hosted deployments,
 * non-loopback hosts, mismatched ports, malformed hosts -- keeps using the
 * trusted configured origin, so an attacker-supplied `Host` header can never
 * redirect a confirmation email off the canonical origin.
 *
 * The same contract governs the hops *after* the emailed link is opened.
 * `NextRequest.url` is not the URL the browser asked for: Next.js rebuilds it
 * from the server's own binding, so a route handler reading `request.url` on
 * the loopback stack sees `http://localhost:<port>` no matter which loopback
 * spelling the browser used. Redirects derived from it therefore move the
 * browser off the origin that holds the session and verifier cookies. Auth
 * handlers resolve their redirect origin through `resolveAuthRedirectOrigin`
 * instead, which is this same validated selection.
 */

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

/** `URL.hostname` keeps IPv6 brackets; compare on the bare hostname. */
function bareHostname(hostname: string) {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

export function isLoopbackHostname(hostname: string | null | undefined) {
  if (!hostname) return false;
  return LOOPBACK_HOSTNAMES.has(bareHostname(hostname.trim().toLowerCase()));
}

function parseOrigin(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.hostname ? url : null;
  } catch {
    return null;
  }
}

/**
 * A `Host` header is a bare authority, not a URL. Reject anything carrying
 * userinfo, a path, a proxy-appended list, or control/whitespace characters
 * before it is parsed, so only a plain `host[:port]` can be considered.
 */
function parseRequestHost(requestHost: string | null | undefined) {
  if (!requestHost) return null;
  const candidate = requestHost.trim();
  if (!candidate || candidate.length > 255) return null;
  if (/[\s,/\\@?#]/u.test(candidate)) return null;
  return parseOrigin(`http://${candidate}`);
}

/**
 * The origin that both stores the PKCE verifier and receives the emailed
 * confirmation link. Returns `configuredOrigin` unchanged unless the request
 * is the same loopback service on the same port.
 */
export function resolveAuthRequestOrigin({
  configuredOrigin,
  requestHost,
}: {
  configuredOrigin: string;
  requestHost: string | null | undefined;
}): string {
  const configured = parseOrigin(configuredOrigin);
  // A hosted or unparseable configuration never consults the request.
  if (!configured || !isLoopbackHostname(configured.hostname)) {
    return configuredOrigin;
  }

  const request = parseRequestHost(requestHost);
  if (!request || !isLoopbackHostname(request.hostname)) {
    return configuredOrigin;
  }

  // Same machine, different service: a mismatched port is a different origin
  // and a different verifier cookie jar, so it is refused like any other host.
  const configuredPort =
    configured.port || (configured.protocol === "https:" ? "443" : "80");
  const requestPort = request.port || "80";
  if (configuredPort !== requestPort) {
    return configuredOrigin;
  }

  // Keep the configured scheme; only the loopback hostname spelling moves.
  return `${configured.protocol}//${request.host}`;
}

/** Only `NEXT_PUBLIC_SITE_URL` and `VERCEL_URL` are read. */
export type SiteOriginEnv = Readonly<Record<string, string | undefined>>;

/**
 * The deployment's canonical origin. This is the trusted half of the selection
 * above: it comes from configuration only, never from the request.
 */
export function resolveConfiguredSiteOrigin(
  env: SiteOriginEnv = process.env,
): string {
  const configuredSiteUrl = env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercelSiteUrl = env.VERCEL_URL
    ? `https://${env.VERCEL_URL}`
    : undefined;

  return (
    configuredSiteUrl ||
    vercelSiteUrl ||
    "http://localhost:3000"
  ).replace(/\/+$/u, "");
}

/**
 * The origin an auth handler must redirect to. Hosted deployments are pinned to
 * the configured canonical origin regardless of `Host`; only a loopback
 * deployment answering on the same loopback service and port keeps the spelling
 * the browser actually used, because that is the cookie origin holding the
 * session and PKCE verifier.
 */
export function resolveAuthRedirectOrigin(
  requestHost: string | null | undefined,
  env: SiteOriginEnv = process.env,
): string {
  return resolveAuthRequestOrigin({
    configuredOrigin: resolveConfiguredSiteOrigin(env),
    requestHost,
  });
}
