import "server-only";

const SUPABASE_PROJECT_HOST_PATTERN = /^([a-z0-9]{20})\.supabase\.co$/;

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

/**
 * Stable, non-secret coordinate for the backend that owns one CSF email.
 *
 * Resend webhooks are account-wide: every subscribed endpoint receives every
 * matching event. The signed provider payload therefore needs a backend
 * coordinate in addition to its organization coordinate, or a Development event
 * can be mistaken for malformed Production data (and vice versa).
 *
 * Hosted environments fail closed when the Supabase URL cannot be resolved. A
 * missing URL is accepted only outside Vercel so pure unit tests and local tools
 * that never dispatch mail can still build a draft contract.
 */
export function resolveCsfCommunicationsEnvironment(
  configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
): string {
  if (!configuredUrl) {
    if (process.env.VERCEL) {
      throw new Error(
        "CSF communications require NEXT_PUBLIC_SUPABASE_URL on Vercel.",
      );
    }
    return "local";
  }

  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new Error(
      "CSF communications require a valid NEXT_PUBLIC_SUPABASE_URL.",
    );
  }

  const hostname = url.hostname.toLowerCase();
  if (isLoopbackHost(hostname)) return "local";

  const projectRef = hostname.match(SUPABASE_PROJECT_HOST_PATTERN)?.[1];
  if (projectRef) return projectRef;

  throw new Error(
    "CSF communications require a canonical Supabase project URL.",
  );
}
