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

test("visitors see real public projects without an example project card", async () => {
  const html = renderToStaticMarkup(await ProjectsPage());
  const feedIndex = html.indexOf('data-testid="public-project-feed"');

  expect(html).toContain('href="/signup"');
  expect(html).toContain('href="/organization"');
  expect(html).toContain('href="/signup?redirect=%2Fprojects%2Fcreate"');
  expect(html).not.toContain('aria-label="Example project"');
  expect(html).not.toContain("Example project");
  expect(html).not.toContain("Park cleanup");
  expect(feedIndex).toBeGreaterThan(0);
  expect(html).not.toMatch(/(?:over 1000 volunteers|36 more upcoming)/iu);
});
