const BYPASS_COOKIE_NAME = "_vercel_jwt";

function fail(message) {
  throw new Error(message);
}

function parseBypassCookie(headers) {
  const values =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie")].filter(Boolean);
  const prefix = `${BYPASS_COOKIE_NAME}=`;
  const serialized = values.find((value) =>
    value.trimStart().startsWith(prefix),
  );
  const pair = serialized?.split(";", 1)[0]?.trim() ?? "";
  const value = pair.startsWith(prefix) ? pair.slice(prefix.length) : "";
  if (!value || /[\s;,]/u.test(value)) {
    fail("Vercel did not return a valid automation bypass cookie.");
  }
  return value;
}

/**
 * @param {{
 *   appUrl: URL;
 *   fetchImpl?: (input: URL, init: RequestInit) => Promise<Response>;
 *   path: string;
 *   protectionBypass: string;
 * }} input
 */
export async function requestVercelBypassCookie({
  appUrl,
  fetchImpl = fetch,
  path,
  protectionBypass,
}) {
  if (appUrl.protocol !== "https:") {
    fail("The Vercel bypass cookie origin must use HTTPS.");
  }
  if (!protectionBypass || /[\r\n]/u.test(protectionBypass)) {
    fail("The Vercel automation bypass secret is missing or malformed.");
  }
  const target = new URL(path, appUrl);
  if (target.origin !== appUrl.origin || !target.pathname.startsWith("/")) {
    fail("The Vercel bypass cookie target is invalid.");
  }
  const response = await fetchImpl(target, {
    headers: {
      "x-vercel-protection-bypass": protectionBypass,
      "x-vercel-set-bypass-cookie": "true",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status < 300 || response.status >= 400) {
    fail("Vercel did not issue the automation bypass redirect.");
  }
  const location = response.headers.get("location");
  if (!location) fail("Vercel did not return the automation bypass redirect.");
  const destination = new URL(location, target);
  if (
    destination.origin !== target.origin ||
    destination.pathname !== target.pathname
  ) {
    fail("Vercel returned an unsafe automation bypass redirect.");
  }
  return {
    httpOnly: true,
    name: BYPASS_COOKIE_NAME,
    path: "/",
    sameSite: "Lax",
    secure: true,
    value: parseBypassCookie(response.headers),
    domain: appUrl.hostname,
  };
}
