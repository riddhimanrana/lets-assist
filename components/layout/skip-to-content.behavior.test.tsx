import { beforeEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let pathname: string | null = "/";
mock.module("next/navigation", () => ({ usePathname: () => pathname }));
const { SkipToContentLink } = await import("./SkipToContentLink");
beforeEach(() => {
  pathname = "/";
});

test("nested account and admin routes use a native anchor after repeated navigation", () => {
  for (const path of [
    "/account",
    "/account/profile",
    "/account/security",
    "/admin",
    "/admin/waivers",
    "/admin/moderation",
  ]) {
    pathname = path;
    const html = renderToStaticMarkup(<SkipToContentLink />);
    expect(html).toContain('href="#page-content"');
    expect(html).toContain("Skip to content");
    expect(html).not.toContain("onclick");
  }
});
test("ordinary routes keep the root main target", () => {
  for (const path of ["/", "/home", "/projects", "/organization/fictional"]) {
    pathname = path;
    expect(renderToStaticMarkup(<SkipToContentLink />)).toContain(
      'href="#main-content"',
    );
  }
});
test("similar prefixes do not select a missing nested target", () => {
  for (const path of [
    "/accountant",
    "/administrator",
    "/administration/example",
  ]) {
    pathname = path;
    expect(renderToStaticMarkup(<SkipToContentLink />)).toContain(
      'href="#main-content"',
    );
  }
});
test("an unavailable compatibility pathname retains the root main fallback", () => {
  pathname = null;
  expect(renderToStaticMarkup(<SkipToContentLink />)).toContain(
    'href="#main-content"',
  );
});
