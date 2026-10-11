/** A public landing visit can opt out of the usual signed-in home redirect. */
export function shouldRenderPublicLanding(
  method: string,
  pathname: string,
  noRedirect: string | null,
): boolean {
  return method === "GET" && pathname === "/" && noRedirect === "1";
}
