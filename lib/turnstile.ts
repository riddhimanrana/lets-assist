import {
  canBypassTurnstile,
  turnstileHostnames,
} from "./auth/turnstile-policy";

export async function verifyTurnstileToken(
  token: string,
  expectedAction: string,
): Promise<boolean> {
  if (canBypassTurnstile(process.env)) return true;
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const hosts = turnstileHostnames(process.env);
  if (
    !secret ||
    !process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ||
    !hosts.size ||
    typeof token !== "string" ||
    !token.trim() ||
    token.length > 2048 ||
    !/^[a-z0-9_-]{1,32}$/.test(expectedAction)
  )
    return false;
  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret, response: token }),
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
        cache: "no-store",
      },
    );
    if (!response.ok) return false;
    const data: unknown = await response.json();
    if (!data || typeof data !== "object") return false;
    const result = data as {
      success?: unknown;
      hostname?: unknown;
      action?: unknown;
    };
    return (
      result.success === true &&
      typeof result.hostname === "string" &&
      hosts.has(result.hostname) &&
      result.action === expectedAction
    );
  } catch {
    return false;
  }
}

/** Missing hosted configuration must require verification, never waive it. */
export function isTurnstileTokenRequired(): boolean {
  return !canBypassTurnstile(process.env);
}
