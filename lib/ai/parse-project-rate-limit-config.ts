export const PARSE_PROJECT_RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
export const PARSE_PROJECT_USER_LIMIT = 20;
export const PARSE_PROJECT_IP_LIMIT = 60;

export function getRequestIp(headers: Headers): string | null {
  const forwardedFor = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate =
    headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    forwardedFor;

  return candidate ? candidate.slice(0, 128) : null;
}
