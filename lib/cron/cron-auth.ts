import { timingSafeEqual } from "node:crypto";

/**
 * One anchored grammar so a presented token cannot carry padding, whitespace,
 * or control bytes.
 */
const BEARER_GRAMMAR = /^Bearer ([\x21-\x7E]+)$/;

/**
 * Tokens a scheduler may present to a cron route: any route-specific worker
 * token plus both shared cron secrets. Vercel Cron always sends
 * `CRON_SECRET`, so a route must accept it even when `CRON_TOKEN` or a worker
 * token is also configured. Read per request so a rotated secret applies
 * immediately.
 */
export function cronTokens(
  ...routeTokens: Array<string | undefined>
): string[] {
  return [
    ...routeTokens,
    process.env.CRON_TOKEN,
    process.env.CRON_SECRET,
  ].filter((value): value is string => Boolean(value));
}

/**
 * Timing-safe bearer check. No configured token means no access, never
 * fail-open. `reduce`, not `some`, so the comparison count does not depend on
 * which token matched.
 */
export function isCronBearerAuthorized(
  authorization: string | null,
  allowedTokens: readonly string[],
): boolean {
  if (allowedTokens.length === 0) return false;
  const match =
    typeof authorization === "string"
      ? BEARER_GRAMMAR.exec(authorization)
      : null;
  if (!match) return false;

  const presented = Buffer.from(match[1], "utf8");
  return allowedTokens.reduce((matched, token) => {
    const expected = Buffer.from(token, "utf8");
    const equal =
      expected.length === presented.length &&
      timingSafeEqual(expected, presented);
    return equal || matched;
  }, false);
}
