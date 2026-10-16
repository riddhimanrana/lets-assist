import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { landingDemoAssets } from "./landing-demo-assets";
import { LandingDemoWindowChrome } from "./LandingDemoWindowChrome";

describe("landing demo assets", () => {
  test("uses repository assets for every supported loopback Supabase host", () => {
    for (const url of [
      "http://127.0.0.1:55321",
      "http://localhost:54321",
      "http://[::1]:54321",
    ]) {
      const assets = landingDemoAssets(url);
      expect(assets.projectId).toBe("10000000-0000-4000-8000-000000000020");
      expect(assets.projectImage).toBe(
        "/demo/projects/santa-cruz-beach-cleanup.png",
      );
      expect(assets.coordinatorImage).toBe("/demo/avatars/riddhiman-rana.png");
    }
  });

  test("keeps hosted public assets outside local development", () => {
    const assets = landingDemoAssets("https://example.supabase.co");
    expect(assets.projectId).toBe("7b3e75d0-78d6-4857-9b21-4bcbf3b744d3");
    expect(assets.projectImage).toStartWith("https://api.lets-assist.com/");
    expect(assets.coordinatorImage).toStartWith("https://api.lets-assist.com/");
  });

  test("shows a UUID-shaped demo address as text, without a live project link", () => {
    const address = `lets-assist.com/projects/${landingDemoAssets(undefined).projectId}`;
    const html = renderToStaticMarkup(
      createElement(LandingDemoWindowChrome, { displayUrl: address }),
    );
    expect(html).toContain(address);
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("Sample project");
    expect(html).not.toContain("santa-cruz-beach-cleanup");
  });
});
