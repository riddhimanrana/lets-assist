import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("server-only", () => ({}));
mock.module("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
mock.module("@/app/admin/server/landing-demo-mode", () => ({
  setLandingDemoMode: async () => ({}),
  getLandingDemoModeForAdmin: async () => ({ enabled: false }),
}));
const { LandingDemoControl } = await import("./LandingDemoControl");

test("real mode is labelled with global landing-only scope and a named switch", () => {
  const html = renderToStaticMarkup(<LandingDemoControl enabled={false} />);
  expect(html).toContain("Demo preview on the landing page");
  expect(html).toContain(
    "Applies to everyone visiting the public landing page.",
  );
  expect(html).toContain("Home dashboards and real projects stay unchanged.");
  expect(html).toContain('role="switch"');
  expect(html).toContain('aria-checked="false"');
  const label = html.match(/<label[^>]*for="([^"]+)"/);
  expect(label?.[1]).toBeDefined();
  expect(html).toContain(`id="${label?.[1]}"`);
  const namedSwitch = html.match(/role="switch"[^>]*aria-labelledby="([^"]+)"/);
  expect(namedSwitch?.[1]).toBeDefined();
  expect(html).toContain(`id="${namedSwitch?.[1]}"`);
  expect(html).toContain("Real content");
  expect(html).toContain('href="/?noRedirect=1"');
  expect(html).not.toContain("browser session");
});

test("demo mode carries a visible sample-content notice", () => {
  const html = renderToStaticMarkup(<LandingDemoControl enabled />);
  expect(html).toContain('aria-checked="true"');
  expect(html).toContain("Sample content. Fictional");
  expect(html).not.toContain("Real content");
});

test("unknown mode disables saving, names the failure, and offers reload", () => {
  const html = renderToStaticMarkup(<LandingDemoControl enabled={null} />);
  expect(html).toContain("Mode unavailable");
  expect(html).toContain("Unable to load landing page mode.");
  expect(html).toContain('role="alert"');
  expect(html).toMatch(/role="switch"[^>]*aria-disabled="true"/);
  expect(html).toContain(">Reload</button>");
  expect(html).not.toContain("Real content");
});
