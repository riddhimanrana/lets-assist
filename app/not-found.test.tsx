import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MainContent } from "@/components/layout/MainContent";
import NotFound from "./not-found";

test("the root 404 supplies a focusable nested-route skip destination", () => {
  const html = renderToStaticMarkup(
    <MainContent>
      <NotFound />
    </MainContent>,
  );
  expect(html.match(/<main\b/g)).toHaveLength(1);
  expect(html.match(/id="page-content"/g)).toHaveLength(1);
  expect(html).toContain('id="page-content" tabindex="-1"');
  expect(html).toContain('id="main-content"');
  expect(html).toContain("Page not found");
  expect(html).toContain('href="/"');
  expect(html).toContain('href="/projects"');
});
