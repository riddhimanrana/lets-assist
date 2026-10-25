import { beforeEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let enabled: boolean | null = false;
let user: { id: string } | null = null;
mock.module("server-only", () => ({}));
mock.module("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => ({ user }),
}));
mock.module("@/lib/home/landing-demo-mode", () => ({
  readPublicLandingDemoMode: async () => ({ enabled }),
}));
mock.module("./_components/Hero", () => ({
  Hero: () => <div>LIVE_LANDING_HERO</div>,
}));
mock.module("./LandingLazySections", () => ({
  LandingLazySections: () => <div>LIVE_LANDING_SECTIONS</div>,
}));
mock.module("./_components/SmoothScroll", () => ({ default: () => null }));

const { default: landing } = await import("./page");
const { MainContent } = await import("@/components/layout/MainContent");
const render = async (params = {}) =>
  renderToStaticMarkup(
    await landing({ searchParams: Promise.resolve(params) }),
  );
beforeEach(() => {
  enabled = false;
  user = null;
});

test("the public landing page defaults to existing real content", async () => {
  const html = await render();
  expect(html).toContain("LIVE_LANDING_HERO");
  expect(html).toContain("LIVE_LANDING_SECTIONS");
  expect(html).not.toContain("data-demo-notice");
  expect(html).not.toContain('data-slot="landing-demo-control"');
});
test("an enabled global mode shows six labelled fictional projects to anonymous visitors", async () => {
  enabled = true;
  const html = await render();
  expect(html).toContain('data-demo-notice="permanent"');
  expect(html).toContain(
    "The numbers and projects in this section are fictional.",
  );
  expect(html.match(/data-demo-project="demo-project-/g)).toHaveLength(6);
  expect(html).toContain('data-demo-counter="demo-counter-volunteers">5,000');
  expect(html).not.toContain("landing-demo-control");
});
test("the same mode is available to signed-in visitors viewing the landing page", async () => {
  enabled = true;
  user = { id: "fictional-user" };
  expect(await render({ noRedirect: "1" })).toContain(
    'data-demo-notice="permanent"',
  );
});
test("unknown settings fail closed to real content", async () => {
  enabled = null;
  expect(await render()).not.toContain("data-demo-notice");
});
test("ordinary signed-in navigation keeps its existing home redirect", async () => {
  enabled = true;
  user = { id: "fictional-user" };
  await expect(render()).rejects.toThrow("REDIRECT:/home");
});
test("the landing page leaves the main landmark to the root layout", async () => {
  for (const demo of [false, true]) {
    enabled = demo;
    const page = await landing({ searchParams: Promise.resolve({}) });
    expect(renderToStaticMarkup(page)).not.toContain("<main");

    // Inside the layout's real main there is one landmark, not a nested pair.
    const html = renderToStaticMarkup(<MainContent>{page}</MainContent>);
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).toStartWith('<main id="main-content"');
    expect(html).toContain("LIVE_LANDING_HERO");
    expect(html).toContain("LIVE_LANDING_SECTIONS");
    expect(html).toContain("overflow-x-hidden");
  }
});
test("email error screens do not acquire demo content", async () => {
  enabled = true;
  const html = await render({
    error: "invalid",
    error_description: "fictional test error",
  });
  expect(html).toContain("Email verification error");
  expect(html).not.toContain("data-demo-notice");
});
