type Environment = Record<string, string | undefined>;

export function isLoopbackUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function canBypassTurnstile(environment: Environment): boolean {
  if (environment.VERCEL || environment.VERCEL_ENV) return false;
  if (
    !isLoopbackUrl(environment.NEXT_PUBLIC_SITE_URL) ||
    !isLoopbackUrl(environment.NEXT_PUBLIC_SUPABASE_URL) ||
    environment.NEXT_PUBLIC_REMOTE_SUPABASE_URL
  )
    return false;
  return (
    environment.TURNSTILE_BYPASS === "true" ||
    (environment.NODE_ENV !== "production" &&
      !environment.NEXT_PUBLIC_TURNSTILE_SITE_KEY &&
      !environment.TURNSTILE_SECRET_KEY)
  );
}

/** Hostnames come from deployment configuration, never request headers. */
export function turnstileHostnames(environment: Environment): Set<string> {
  const hosts = new Set<string>();
  const sources = [environment.NEXT_PUBLIC_SITE_URL];
  if (environment.VERCEL_ENV === "production") {
    sources.push("https://lets-assist.com", "https://www.lets-assist.com");
  } else if (environment.VERCEL_ENV) {
    for (const value of [
      environment.VERCEL_URL,
      environment.VERCEL_BRANCH_URL,
    ]) {
      if (value && /^[a-z0-9-]+\.vercel\.app$/i.test(value))
        sources.push(`https://${value}`);
    }
  }
  for (const source of sources) {
    if (!source) continue;
    try {
      const url = new URL(source);
      if (url.username || url.password || url.search || url.hash) continue;
      if (url.protocol !== "https:" && !isLoopbackUrl(source)) continue;
      if (environment.VERCEL_ENV && isLoopbackUrl(source)) continue;
      if (
        environment.VERCEL_ENV &&
        environment.VERCEL_ENV !== "production" &&
        ["lets-assist.com", "www.lets-assist.com"].includes(url.hostname)
      )
        continue;
      hosts.add(url.hostname);
    } catch {
      /* Invalid configuration fails closed. */
    }
  }
  return hosts;
}

export const ANONYMOUS_SIGNUP_ACTION = "anonymous-signup";
export const ANONYMOUS_CONFIRMATION_ACTION = "anonymous-confirmation";
