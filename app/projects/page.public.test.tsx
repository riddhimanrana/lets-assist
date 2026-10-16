import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => ({ user: null }),
}));
mock.module("@/components/projects/ProjectsInfiniteScroll", () => ({
  ProjectsInfiniteScroll: () => <div data-testid="public-project-feed" />,
}));
mock.module("./UserProjects", () => ({ default: () => null }));

const { default: ProjectsPage } = await import("./page");

test("visitors see a clear path and a separate, non-live example before the feed", async () => {
  const html = renderToStaticMarkup(await ProjectsPage());
  const exampleIndex = html.indexOf('aria-label="Example project"');
  const feedIndex = html.indexOf('data-testid="public-project-feed"');

  expect(html).toContain('href="/signup"');
  expect(html).toContain('href="/organization"');
  expect(html).toContain('href="/signup?redirect=%2Fprojects%2Fcreate"');
  expect(html).toContain("This is a preview, not an open signup.");
  expect(exampleIndex).toBeGreaterThan(0);
  expect(feedIndex).toBeGreaterThan(exampleIndex);
  expect(html).not.toMatch(/(?:over 1000 volunteers|36 more upcoming)/iu);
});
