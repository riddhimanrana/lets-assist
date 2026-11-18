/** Only public event links are accepted. Never retain query parameters or tokens. */
export function canonicalSignUpGeniusUrl(input: unknown): string {
  if (
    typeof input !== "string" ||
    input.length > 2048 ||
    /[\s\\]/u.test(input.trim()) ||
    [...input.trim()].some((c) => c.charCodeAt(0) < 32)
  ) {
    throw new Error("invalid_url");
  }
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("invalid_url");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    ![
      "signupgenius.com",
      "www.signupgenius.com",
      "m.signupgenius.com",
    ].includes(url.hostname)
  ) {
    throw new Error("invalid_url");
  }
  // Reject explicit ports, including default ports normalized away by URL.
  if (
    !/^https?:\/\/(?:www\.|m\.)?signupgenius\.com(?:\/|$)/iu.test(input.trim())
  )
    throw new Error("invalid_url");
  let path = url.pathname;
  if (url.hostname === "m.signupgenius.com" && path === "/" && url.hash) {
    const mobile = /^#!\/showSignUp\/([A-Za-z0-9-]+)$/u.exec(url.hash);
    if (!mobile) throw new Error("invalid_url");
    path = `/go/${mobile[1]}`;
  } else if (url.hash) {
    throw new Error("invalid_url");
  }
  // SignUpGenius public IDs are hexadecimal; optional numeric ID and slug follow.
  const match =
    /^\/go\/([A-Fa-f0-9]{16,32}(?:-[0-9]{1,12})?(?:-[A-Za-z0-9-]{1,160})?)\/?$/u.exec(
      path,
    );
  if (!match) throw new Error("invalid_url");
  return `https://www.signupgenius.com/go/${match[1]}`;
}
