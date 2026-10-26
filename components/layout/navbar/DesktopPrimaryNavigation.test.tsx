import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DesktopPrimaryNavigation } from "./DesktopPrimaryNavigation";

for (const pathname of ["/projects", "/organization"]) {
  test(`current ${pathname} navigation has no persistent pill background`, () => {
    const html = renderToStaticMarkup(
      <DesktopPrimaryNavigation
        isLoading={false}
        isAuthenticated={false}
        pathname={pathname}
      />,
    );
    const current = html.match(/<a[^>]*aria-current="page"[^>]*>/gu) ?? [];
    expect(current).toHaveLength(1);
    expect(current[0]).toContain(`href="${pathname}"`);
    expect(current[0]).not.toContain("aria-[current=page]:bg-");
    expect(current[0]).toContain("aria-[current=page]:hover:bg-transparent");
    expect(current[0]).toContain("focus-visible:ring-");
  });
}
