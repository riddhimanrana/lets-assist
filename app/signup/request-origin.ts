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

/** `NEXT_PUBLIC_SITE_URL`, `VERCEL_URL`, `VERCEL`, and `VERCEL_ENV` are read. */
export type SiteOriginEnv = Readonly<Record<string, string | undefined>>;

/**
 * A site origin must be a plain `http`/`https` origin: no userinfo, no path
 * beyond the root, no query string, no fragment. A value that is merely
 * "close" -- a stray path, embedded credentials, a non-http(s) scheme -- is
 * not good enough: anything that doesn't validate as exactly an origin is
 * treated as absent, the same as an unset variable, so it can never reach a
 * redirect unchanged.
 */
function parseValidSiteOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;

  // `URL#origin` has no trailing slash and no path/query/hash, so this is
  // already the canonical form.
  return url.origin;
}

/**
 * Detected from Vercel's own system environment variables, never from
 * anything the request controls. `VERCEL` and `VERCEL_ENV` are set on every
 * Vercel deployment (Production, Preview, and `vercel dev`); `VERCEL_URL` is
 * checked too as a defensive third signal, since it is set whenever the
 * other two are.
 */
function isHostedDeploymentEnvironment(env: SiteOriginEnv): boolean {
  return Boolean(env.VERCEL || env.VERCEL_ENV || env.VERCEL_URL);
}

/**
 * The deployment's canonical origin. This is the trusted half of the selection
 * above: it comes from configuration only, never from the request.
 *
 * A configured `NEXT_PUBLIC_SITE_URL` always wins when it validates; a
 * platform-issued `VERCEL_URL` is the next fallback. Only when neither
 * resolves to a valid origin does the environment matter:
 *
 * - A hosted (Vercel) deployment throws rather than silently falling back to
 *   a loopback origin -- redirecting a Production or Preview user's browser
 *   to `localhost` is never an acceptable failure mode.
 * - A non-Vercel `NODE_ENV=production` deployment also throws: `localhost`
 *   is never correct for a production server regardless of whether Vercel's
 *   own signals are present.
 * - A local, non-hosted, non-production process keeps the loopback fallback,
 *   since that is the one deployment shape where `localhost` is correct.
 */
export function resolveConfiguredSiteOrigin(
  env: SiteOriginEnv = process.env,
): string {
  const configuredSiteOrigin = parseValidSiteOrigin(env.NEXT_PUBLIC_SITE_URL);
  if (configuredSiteOrigin) return configuredSiteOrigin;

  const vercelSiteOrigin = env.VERCEL_URL
    ? parseValidSiteOrigin(`https://${env.VERCEL_URL}`)
    : null;
  if (vercelSiteOrigin) return vercelSiteOrigin;

  if (isHostedDeploymentEnvironment(env)) {
    throw new Error(
      "No valid site origin is configured for this hosted deployment: " +
        "NEXT_PUBLIC_SITE_URL and VERCEL_URL are both missing or malformed. " +
        "Refusing to fall back to a loopback origin.",
    );
  }

  if (env.NODE_ENV === "production") {
    throw new Error(
      "No valid site origin is configured for this production deployment: " +
        "NEXT_PUBLIC_SITE_URL is missing or malformed. " +
        "Refusing to fall back to a loopback origin.",
    );
  }

  return "http://localhost:3000";
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

/**
 * The origin a client-initiated OAuth flow -- currently only linking a
 * Google identity from account settings (`AuthenticationClient.tsx`) --
 * must hand Supabase as `redirectTo`.
 *
 * That call writes its PKCE verifier as a cookie on whatever origin the
 * browser is actually running on at the moment it's made, before any
 * navigation happens, so the callback has to land back on that same origin
 * to read it -- exactly like the emailed signup/confirmation link. Handing
 * Supabase the page's raw `window.location.origin` unconditionally would
 * let that diverge from what `/auth/callback` resolves to
 * (`resolveAuthRedirectOrigin`, which never trusts the request on a hosted
 * deployment): a browser that reached the app through a stale alias or any
 * non-canonical host would start the flow on one origin and have the
 * server finish it on the canonical one, stranding the verifier cookie.
 *
 * This mirrors `resolveAuthRequestOrigin`'s contract with the client's own
 * signals in place of a request `Host` header, so the two stay consistent:
 * a loopback developer keeps the loopback origin the browser is actually
 * on (matching the server's loopback swap); every hosted deployment is
 * pinned to the canonical configured origin instead of the page's ambient
 * location, so the flow always originates on the same origin the callback
 * will land on. `NEXT_PUBLIC_SITE_URL` is the only signal read -- it is the
 * one canonical-origin input that is actually available in the browser
 * bundle (`VERCEL_URL` is not `NEXT_PUBLIC_`-prefixed and is never
 * inlined), which is why this does not simply delegate to
 * `resolveConfiguredSiteOrigin`.
 */
export function resolveClientAuthOrigin(
  publicSiteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL,
): string {
  const configured = parseValidSiteOrigin(publicSiteUrl);

  if (typeof window === "undefined") {
    // SSR: use configured if available; localhost is only appropriate for
    // local non-hosted development where no valid canonical URL is configured.
    return configured ?? "http://localhost:3000";
  }

  if (configured) {
    // Configured canonical exists: pin hosted deployments to it and apply the
    // narrow loopback-spelling swap for local development.
    return resolveAuthRequestOrigin({
      configuredOrigin: configured,
      requestHost: window.location.host,
    });
  }

  // No configured canonical in browser context: derive the origin from the
  // page's actual location rather than inventing localhost:3000. A hosted
  // preview with no NEXT_PUBLIC_SITE_URL inlined at build time would otherwise
  // hand Supabase a dead redirectTo that the user can never reach.
  const windowOrigin = parseValidSiteOrigin(window.location.origin);
  return windowOrigin ?? "http://localhost:3000";
}
